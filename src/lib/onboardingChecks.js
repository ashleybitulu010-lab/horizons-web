import { resolveClientId, supabaseCount } from '@/lib/supabaseRest';
import { normalizeChatIcons } from '@/lib/textEncoding';
import pb from '@/lib/pocketbaseClient';

/** Assistant replies that confirm a successful operation. */
const SUCCESS_PATTERNS = {
  produit: [
    /produit[\s\S]{0,120}(enregistr|ajout|cr[éeé]{1,3}|sauv|ok|succ[eè]s|not[ée]|mis [àa] jour)/i,
    /(enregistr|ajout|cr[éeé]{1,3})[\s\S]{0,60}produit/i,
    /nouveau produit/i,
    /produit ajout/i,
  ],
  stock: [
    /stock[\s\S]{0,120}(ajout|enregistr|mis [àa] jour|prêt|ok|succ[eè]s|actualis)/i,
    /(ajout|enregistr|mis [àa] jour)[\s\S]{0,60}stock/i,
    /quantit[ée][\s\S]{0,60}(ajout|enregistr|ok|succ[eè]s)/i,
  ],
  vente: [
    /vente[\s\S]{0,120}(enregistr|ajout|ok|cr[éeé]{1,3}|succ[eè]s|mise? [àa] jour)/i,
    /(enregistr|ajout)[\s\S]{0,60}vente/i,
    /vendu[\s\S]{0,60}(enregistr|ok|succ[eè]s|\d)/i,
    /transaction[\s\S]{0,60}enregistr/i,
  ],
  depense: [
    /d[ée]pense[\s\S]{0,120}(enregistr|ajout|ok|cr[éeé]{1,3}|succ[eè]s)/i,
    /(enregistr|ajout)[\s\S]{0,60}d[ée]pense/i,
    /paiement[\s\S]{0,60}(enregistr|ok|succ[eè]s)/i,
  ],
  rapport: [
    /bilan/i,
    /\.pdf/i,
    /rapport[\s\S]{0,60}(g[ée]n[ée]r|prêt|disponible|ok)/i,
    /https?:\/\/\S+\.pdf/i,
    /voici[\s\S]{0,60}(votre\s+)?(bilan|rapport)/i,
  ],
};

/** Loose positive signals from Ash (main chat). */
const POSITIVE_ASSISTANT = [
  /enregistr/i,
  /ajout/i,
  /mis [àa] jour/i,
  /succ[eè]s/i,
  /bravo/i,
  /parfait/i,
  /✅/,
  /prêt/i,
  /cr[éeé]{1,3}/i,
];

const NEGATIVE_ASSISTANT = [
  /impossible/i,
  /erreur/i,
  /introuvable/i,
  /échec/i,
  /⚠/,
  /❌/,
];

/** User messages that look like an attempt for the current step. */
const USER_ATTEMPT_PATTERNS = {
  produit: [/produit/i, /craie/i, /cahier/i, /nom\s*[:=]/i, /prix/i, /nouveau/i, /achat/i, /vente\s*[:=]/i, /\b\d+\b/],
  stock: [/stock/i, /quantit/i, /bo[iî]tes?/i, /\b\d+\b/, /ajouter/i, /réappro/i],
  vente: [/\bvendu\b/i, /\bvente\b/i, /client\s+a/i, /achet[ée]/i, /encaiss/i, /\b\d+\b/],
  depense: [/d[ée]pense/i, /pay[ée]/i, /paiement/i, /transport|carton|lectricit|loyer/i, /achet[ée]/i, /\b\d+\b/],
  rapport: [/bilan/i, /rapport/i, /\bpdf\b/i, /g[ée]n[eè]re/i],
};

const TABLE_MAP = {
  produit: 'produits',
  stock: 'stocks',
  vente: 'ventes',
  depense: 'depenses',
};

function recentMessages(messages, limit = 16) {
  return (messages || []).slice(-limit);
}

function textOf(m) {
  return normalizeChatIcons(m?.content || m?.message || '');
}

function textMatchesAny(text, patterns) {
  if (!text) return false;
  return (patterns || []).some((re) => re.test(text));
}

/**
 * Validate from recent main-chat exchange.
 * Accepts: matching success phrase, OR (user attempt + positive assistant reply without error).
 */
export function exchangeLooksSuccessful(check, messages) {
  const patterns = SUCCESS_PATTERNS[check];
  const attempts = USER_ATTEMPT_PATTERNS[check];
  if (!patterns?.length) return false;

  const recent = recentMessages(messages, 16);
  const users = recent.filter((m) => m.role === 'user').slice(-6);
  const assistants = recent.filter((m) => m.role === 'assistant').slice(-6);

  const lastAssistants = assistants.map(textOf);
  if (lastAssistants.some((t) => textMatchesAny(t, patterns))) return true;

  const userTried = !attempts?.length
    || users.some((m) => textMatchesAny(textOf(m), attempts));
  if (!userTried) return false;

  return lastAssistants.some((t) => {
    if (!t) return false;
    if (textMatchesAny(t, NEGATIVE_ASSISTANT)) return false;
    return textMatchesAny(t, POSITIVE_ASSISTANT);
  });
}

function userAttemptedSale(messages) {
  const recent = recentMessages(messages, 8)
    .filter((m) => m.role === 'user')
    .map((m) => textOf(m).toLowerCase());
  return recent.some((t) => /\b(vendu|vente|j['']ai vendu|client a)\b/i.test(t));
}

async function countForClient(table, clientId) {
  return supabaseCount(table, `client_id=eq.${encodeURIComponent(clientId)}`);
}

async function hasReport(user) {
  if (!user?.id) return false;
  try {
    const list = await pb.collection('reports').getList(1, 1, {
      filter: `owner = "${user.id}"`,
      sort: '-created',
      requestKey: 'onboarding-reports',
    });
    return (list?.items?.length || 0) > 0;
  } catch {
    return false;
  }
}

/** Snapshot row counts so relaunching the guide requires NEW actions. */
export async function snapshotOnboardingBaselines(user) {
  const empty = { produit: 0, stock: 0, vente: 0, depense: 0, rapport: 0 };
  try {
    const clientId = await resolveClientId(user);
    if (!clientId) {
      return { ...empty, rapport: (await hasReport(user)) ? 1 : 0 };
    }
    const [produit, stock, vente, depense] = await Promise.all([
      countForClient('produits', clientId),
      countForClient('stocks', clientId),
      countForClient('ventes', clientId),
      countForClient('depenses', clientId),
    ]);
    return {
      produit,
      stock,
      vente,
      depense,
      rapport: (await hasReport(user)) ? 1 : 0,
    };
  } catch {
    return empty;
  }
}

/**
 * Validate an onboarding step.
 * Chat exchange is checked first (fast UX), then Supabase growth vs baseline.
 */
export async function checkOnboardingStep(check, user, mainChatMessages = [], options = {}) {
  if (!check) return false;
  const baselines = options.baselines || null;
  const baseline = baselines ? Number(baselines[check] || 0) : null;

  // 1) Chat confirmation — works even if baselines are still loading.
  if (exchangeLooksSuccessful(check, mainChatMessages)) return true;

  if (check === 'rapport') {
    if (await hasReport(user)) {
      if (baseline === null || baseline <= 0) return true;
    }
    return false;
  }

  // 2) Supabase growth vs baseline (when available)
  if (baseline === null) return false;

  const clientId = await resolveClientId(user);
  if (!clientId) return false;
  const table = TABLE_MAP[check];
  if (!table) return false;
  const count = await countForClient(table, clientId);
  return count > baseline;
}

export function detectPrematureSale(stepIndex, mainChatMessages) {
  if (stepIndex >= 2) return false;
  return userAttemptedSale(mainChatMessages);
}

export const HUMAN_ESCALATION_PATTERNS = [
  /abonnement/i,
  /paiement\s+(non\s+)?re[çc]u/i,
  /pas\s+(re[çc]u|valid)/i,
  /\bbug\b/i,
  /technique/i,
  /connexion/i,
  /ne\s+marche\s+pas/i,
  /probl[eè]me\s+de\s+compte/i,
  /mon\s+compte/i,
  /aide\s+humaine/i,
  /parler\s+[àa]\s+un\s+(humain|conseiller|agent)/i,
  /support\s+humain/i,
];

export function needsHumanEscalation(text) {
  const t = (text || '').trim();
  if (!t) return false;
  return HUMAN_ESCALATION_PATTERNS.some((re) => re.test(t));
}
