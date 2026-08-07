/**
 * Lightweight checks for guide validation heuristics (no network).
 * Inline copies of pure helpers — keep in sync with onboardingChecks.js
 */
const SUCCESS_PATTERNS = {
  produit: [
    /produit[\s\S]{0,80}(enregistr|cr[éeé]{1,3}|ajout|sauv|ok|succ[eè]s|not[ée])/i,
    /(enregistr|cr[éeé]{1,3}|ajout)[\s\S]{0,40}produit/i,
    /nouveau produit/i,
  ],
  vente: [
    /vente[\s\S]{0,80}(enregistr|ajout|ok|cr[éeé]{1,3}|succ[eè]s)/i,
    /vendu[\s\S]{0,40}(enregistr|ok|succ[eè]s|\d)/i,
  ],
};
const USER_ATTEMPT = {
  produit: [/produit/i, /craie/i, /prix/i],
  vente: [/\bvendu\b/i, /\bvente\b/i],
};

function exchangeLooksSuccessful(check, messages) {
  const recent = (messages || []).slice(-12);
  const users = recent.filter((m) => m.role === 'user').slice(-4);
  const assistants = recent.filter((m) => m.role === 'assistant').slice(-5);
  const userTried = users.some((m) => USER_ATTEMPT[check].some((re) => re.test(m.content || '')));
  if (!userTried) return false;
  return assistants.some((m) => SUCCESS_PATTERNS[check].some((re) => re.test(m.content || '')));
}

const welcome = {
  role: 'assistant',
  content:
    "👋 Bienvenue sur Ash Ledger !\nJe suis Ash, ton copilote financier. Ensemble, on va suivre tes ventes, tes dépenses, ton stock.",
};

let failed = 0;
function assert(name, cond) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', name);
  } else {
    console.log('OK', name);
  }
}

assert('welcome alone does not validate produit', !exchangeLooksSuccessful('produit', [welcome]));
assert('welcome alone does not validate vente', !exchangeLooksSuccessful('vente', [welcome]));
assert(
  'user+success validates produit',
  exchangeLooksSuccessful('produit', [
    welcome,
    { role: 'user', content: 'Nouveau produit : Craie scolaire' },
    { role: 'assistant', content: '✅ Produit enregistré avec succès !' },
  ]),
);
assert(
  'assistant alone without user attempt fails',
  !exchangeLooksSuccessful('produit', [
    { role: 'assistant', content: 'Produit enregistré avec succès' },
  ]),
);
assert(
  'vente success after user sold',
  exchangeLooksSuccessful('vente', [
    { role: 'user', content: "J'ai vendu 10 boîtes" },
    { role: 'assistant', content: 'Vente enregistrée — 10 boîtes.' },
  ]),
);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nAll onboarding heuristic checks passed');
