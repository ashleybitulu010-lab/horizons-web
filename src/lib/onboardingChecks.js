import { resolveClientId, supabaseSelect } from '@/lib/supabaseRest';
import pb from '@/lib/pocketbaseClient';

const SUCCESS_PATTERNS = {
  produit: [
    /produit.*(enregistr|cr[ée]{1,2}|ajout|sauv|ok)/i,
    /bravo.*produit/i,
    /nom_produit/i,
    /craie scolaire/i,
  ],
  stock: [
    /stock.*(ajout|enregistr|mis à jour|prêt|ok)/i,
    /quantit[ée].*(ajout|enregistr)/i,
    /100\s*bo[iî]tes/i,
  ],
  vente: [
    /vente.*(enregistr|ajout|ok|cr[ée]{1,2})/i,
    /vendu/i,
    /transaction.*enregistr/i,
  ],
  depense: [
    /d[ée]pense.*(enregistr|ajout|ok|cr[ée]{1,2})/i,
    /paiement.*(enregistr|ok)/i,
  ],
  rapport: [
    /bilan/i,
    /\.pdf/i,
    /rapport.*(g[ée]n[ée]r|prêt|disponible)/i,
    /https?:\/\/\S+\.pdf/i,
  ],
};

function textLooksSuccessful(check, messages) {
  const patterns = SUCCESS_PATTERNS[check] || [];
  if (!patterns.length) return false;
  const recent = (messages || [])
    .filter((m) => m.role === 'assistant')
    .slice(-8)
    .map((m) => m.content || '');
  return recent.some((text) => patterns.some((re) => re.test(text)));
}

function userAttemptedSale(messages) {
  const recent = (messages || [])
    .filter((m) => m.role === 'user')
    .slice(-5)
    .map((m) => (m.content || '').toLowerCase());
  return recent.some((t) =>
    /\b(vendu|vente|acheter|acheté|client a|j['']ai vendu)\b/i.test(t),
  );
}

async function countForClient(table, clientId) {
  const rows = await supabaseSelect(
    table,
    `client_id=eq.${encodeURIComponent(clientId)}&select=id&limit=1`,
  );
  return Array.isArray(rows) && rows.length > 0;
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

/**
 * Validate an onboarding step.
 * Prefer Supabase truth; fall back to recent main-chat assistant replies.
 */
export async function checkOnboardingStep(check, user, mainChatMessages = []) {
  if (!check) return false;

  if (check === 'rapport') {
    if (await hasReport(user)) return true;
    return textLooksSuccessful('rapport', mainChatMessages);
  }

  const clientId = await resolveClientId(user);
  if (clientId) {
    const tableMap = {
      produit: 'produits',
      stock: 'stocks',
      vente: 'ventes',
      depense: 'depenses',
    };
    const table = tableMap[check];
    if (table) {
      const ok = await countForClient(table, clientId);
      if (ok) return true;
    }
  }

  return textLooksSuccessful(check, mainChatMessages);
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
