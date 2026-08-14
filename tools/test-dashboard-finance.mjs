/** Self-contained check mirroring dashboard finance formulas. */

function saleCollected(sale) {
  return Math.max(0, Number(sale.montant_paye) || 0);
}
function saleRevenue(sale) {
  if (sale.total_brut != null) return Math.max(0, Number(sale.total_brut) || 0);
  return saleCollected(sale) + Math.max(0, Number(sale.reste_a_payer) || 0);
}

const ventes = [
  { total_brut: 1525, montant_paye: 1525, reste_a_payer: 0 },
  { total_brut: 465, montant_paye: 0, reste_a_payer: 465 },
];
const depenses = 14;

const encaisse = ventes.reduce((s, v) => s + saleCollected(v), 0);
const dettes = ventes.reduce((s, v) => s + (Number(v.reste_a_payer) || 0), 0);
const ca = ventes.reduce((s, v) => s + saleRevenue(v), 0);
const benefice = ca - depenses;
const marge = (benefice / ca) * 100;

function assert(name, cond, detail) {
  console.log(cond ? 'PASS' : 'FAIL', name, detail ?? '');
  if (!cond) process.exitCode = 1;
}

assert('encaissements', encaisse === 1525, encaisse);
assert('dettes', dettes === 465, dettes);
assert('CA = encaisse + dettes', ca === 1990, ca);
assert('benefice = CA - dep', benefice === 1976, benefice);
assert('marge ~ 99.3%', Math.abs(marge - 99.297487) < 0.01, marge.toFixed(1));

console.log({
  ancienne_carte_haut: 'appelée CA mais = sum(montant_paye) = 1525',
  nouvelle_carte_haut: 'Encaissements = 1525',
  ca_evolution: 1990,
  depenses: 14,
  benefice_evolution: 1976,
  marge: `${marge.toFixed(1)} %`,
});
