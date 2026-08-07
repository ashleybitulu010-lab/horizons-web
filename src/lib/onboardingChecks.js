import { resolveClientId, supabaseCount } from '@/lib/supabaseRest';
import pb from '@/lib/pocketbaseClient';

/** Assistant replies that confirm a successful operation. */
const SUCCESS_PATTERNS = {
  produit: [
    /produit[\s\S]{0,80}(enregistr|cr[éeé]{1,3}|ajout|sauv|ok|succ[eè]s|not[ée])/i,
    /(enregistr|cr[éeé]{1,3}|ajout)[\s\S]{0,40}produit/i,
    /nouveau produit/i,
    /✅[\s\S]{0,40}produit/i,
  ],
  stock: [
    /stock[\s\S]{0,80}(ajout|enregistr|mis [àa] jour|prêt|ok|succ[eè]s|actualis)/i,
    /(ajout|enregistr|mis [àa] jour)[\s\S]{0,40}stock/i,
    /quantit[ée][\s\S]{0,40}(ajout|enregistr|ok|succ[eè]s)/i,
    /✅[\s\S]{0,40}stock/i,
  ],
  vente: [
    /vente[\s\S]{0,80}(enregistr|ajout|ok|cr[éeé]{1,3}|succ[eè]s)/i,
    /(enregistr|ajout)[\s\S]{0,40}vente/i,
    /vendu[\s\S]{0,40}(enregistr|ok|succ[eè]s|\d)/i,
    /transaction[\s\S]{0,40}enregistr/i,
    /✅[\s\S]{0,40}vente/i,
  ],
  depense: [
    /d[ée]pense[\s\S]{0,80}(enregistr|ajout|ok|cr[éeé]{1,3}|succ[eè]s)/i,
    /(enregistr|ajout)[\s\S]{0,40}d[ée]pense/i,
    /paiement[\s\S]{0,40}(enregistr|ok|succ[eè]s)/i,
    /✅[\s\S]{0,40}d[ée]pense/i,
  ],
  rapport: [
    /bilan/i,
    /\.pdf/i,
    /rapport[\s\S]{0,40}(g[ée]n[ée]r|prêt|disponible|ok)/i,
    /https?:\/\/\S+\.pdf/i,
    /voici[\s\S]{0,40}(votre\s+)?(bilan|rapport)/i,
  ],
};

/** User messages that look like an attempt for the current step. */
const USER_ATTEMPT_PATTERNS = {
  produit: [
    /produit/i,
    /craie/i,
    /nom\s*[:=]/i,
    /prix\s*(d['']achat|de\s*vente)/i,
    /achat\s*[:=]?\s*\$?\d/i,
    /nouveau/i,
  ],
  stock: [
    /stock/i,
    /quantit/i,
    /bo[iî]tes?/i,
    /\b\d+\b/,
    /ajouter/i,
  ],
  vente: [
    /\bvendu\b/i,
    /\bvente\b/i,
    /client\s+a/i,
    /achet[ée]/i,
  ],
  depense: [
    /d[ée]pense/i,
    /pay[ée]/i,
    /paiement/i,
    /transport|carton|lectricit|loyer/i,
    /achet[ée]/i,
  ],
  rapport: [
    /bilan/i,
    /rapport/i,
    /\bpdf\b/i,
    /g[ée]n[eè]re/i,
  ],
};

const TABLE_MAP = {
  produit: 'produits',
  stock: 'stocks',
  vente: 'ventes',
  depense: 'depenses',
};

function recentMessages(messages, limit = 12) {
  return (messages || []).slice(-limit);
}

function textMatchesAny(text, patterns) {
  if (!text) return false;
  return (patterns || []).some((re) => re.test(text));
}

/**
 * Require a recent user attempt + assistant confirmation for the same step.
 * Prevents welcome / old history from auto-validating the guide.
 */
export function exchangeLooksSuccessful(check, messages) {
  const patterns = SUCCESS_PATTERNS[check];
  const attempts = USER_ATTEMPT_PATTERNS[check];
  if (!patterns?.length || !attempts?.length) return false;

  const recent = recentMessages(messages, 12);
  const users = recent.filter((m) => m.role === 'user').slice(-4);
  const assistants = recent.filter((m) => m.role === 'assistant').slice(-5);

  const userTried = users.some((m) => textMatchesAny(m.content || m.message || '', attempts));
  if (!userTried) return false;

  return assistants.some((m) => textMatchesAny(m.content || m.message || '', patterns));
}

function userAttemptedSale(messages) {
  const recent = recentMessages(messages, 8)
    .filter((m) => m.role === 'user')
    .map((m) => (m.content || m.message || '').toLowerCase());
  return recent.some((t) =>
    /\b(vendu|vente|j['']ai vendu|client a)\b/i.test(t),
  );
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
 * Prefer Supabase growth vs baseline; fall back to recent main-chat exchange.
 */
export async function checkOnboardingStep(check, user, mainChatMessages = [], options = {}) {
  if (!check) return false;
  const baselines = options.baselines || {};
  const baseline = Number(baselines[check] || 0);

  if (check === 'rapport') {
    if (await hasReport(user)) {
      // New report since baseline, or first-ever report with baseline 0
      if (baseline <= 0) return true;
      // PocketBase has no easy count here — accept exchange success after baseline
    }
    return exchangeLooksSuccessful('rapport', mainChatMessages);
  }

  const clientId = await resolveClientId(user);
  if (clientId) {
    const table = TABLE_MAP[check];
    if (table) {
      const count = await countForClient(table, clientId);
      if (count > baseline) return true;
    }
  }

  return exchangeLooksSuccessful(check, mainChatMessages);
}

export function detectPrematureSale(stepIndex, mainChatMessages) {
  // Steps: 0 produit, 1 stock, 2 vente…
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
