/**
 * Pure validation heuristics used by the Ashy guide (no network).
 */
const SUCCESS_PATTERNS = {
  produit: [/produit[\s\S]{0,120}(enregistr|ajout)/i, /produit ajout/i],
  vente: [/vente[\s\S]{0,120}(enregistr|ajout)/i],
  stock: [/stock[\s\S]{0,120}(ajout|mis [àa] jour)/i],
  depense: [/d[ée]pense[\s\S]{0,120}(enregistr|ajout)/i],
};
const USER_ATTEMPT = {
  produit: [/produit/i, /craie/i, /\b\d+\b/],
  vente: [/\bvendu\b/i, /\bvente\b/i],
};
const POSITIVE = [/enregistr/i, /ajout/i, /succ[eè]s/i];
const NEGATIVE = [/impossible/i, /erreur/i, /introuvable/i];

function exchangeLooksSuccessful(check, messages) {
  const recent = messages.slice(-16);
  const users = recent.filter((m) => m.role === 'user').slice(-6);
  const assistants = recent.filter((m) => m.role === 'assistant').slice(-6).map((m) => m.content);
  if (assistants.some((t) => SUCCESS_PATTERNS[check].some((re) => re.test(t)))) return true;
  const userTried = users.some((m) => USER_ATTEMPT[check].some((re) => re.test(m.content)));
  if (!userTried) return false;
  return assistants.some((t) => !NEGATIVE.some((re) => re.test(t)) && POSITIVE.some((re) => re.test(t)));
}

let failed = 0;
function assert(name, cond) {
  if (!cond) { failed += 1; console.error('FAIL', name); }
  else console.log('OK', name);
}

assert(
  'vente from real n8n reply',
  exchangeLooksSuccessful('vente', [
    { role: 'user', content: "J'ai vendu 40 cahiers\nMontant encaissé : 300$" },
    { role: 'assistant', content: '💰 Vente enregistrée : cahier x40 — total 300$, encaissé 300$.' },
  ]),
);

assert(
  'produit from repaired broken reply',
  exchangeLooksSuccessful('produit', [
    { role: 'user', content: 'Craie scolaire' },
    { role: 'user', content: '5' },
    { role: 'user', content: '8' },
    { role: 'assistant', content: '📋 Produit ajouté : Craie scolaire (divers) — achat 5, vente 8.' },
  ]),
);

assert(
  'welcome alone does not validate',
  !exchangeLooksSuccessful('vente', [
    { role: 'assistant', content: 'Bienvenue — suivez vos ventes et stock.' },
  ]),
);

assert(
  'error reply does not validate',
  !exchangeLooksSuccessful('produit', [
    { role: 'user', content: 'produit test' },
    { role: 'assistant', content: '⚠️ Produit introuvable : « test ».' },
  ]),
);

if (failed) process.exit(1);
console.log('\nAll guide validation checks passed');
