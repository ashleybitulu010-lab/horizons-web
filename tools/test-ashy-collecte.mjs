/**
 * Offline unit tests for Ashy slot-filling rules (mirrors n8n Analyser Intention gate).
 * Does not write to Supabase.
 */

function toNumOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function hasValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  return Number.isFinite(v);
}
function hasPositive(v) {
  const n = toNumOrNull(v);
  return n !== null && n > 0;
}
function requiredFor(intention, action) {
  if (intention === 'produit' && (action === 'ajouter' || !action)) return ['nom', 'prix_achat', 'prix_vente'];
  if (intention === 'stock' && (action === 'ajouter' || action === 'retirer' || !action)) return ['produit', 'quantite'];
  if (intention === 'vente') return ['produit', 'quantite', 'prix_unitaire'];
  if (intention === 'depense') return ['libelle', 'montant_total'];
  return [];
}
function missingSlots(intention, action, slots) {
  return requiredFor(intention, action).filter((k) => {
    if (['quantite', 'prix_achat', 'prix_vente', 'prix_unitaire', 'montant_total'].includes(k)) return !hasPositive(slots[k]);
    return !hasValue(slots[k]);
  });
}
function looksAmbiguousBuy(text) {
  const t = String(text || '').toLowerCase();
  if (!/achet|re[cç]u|livr/.test(t)) return false;
  if (/nouveau produit|produit\s*:|prix d['']?achat|prix de vente|au stock|en stock|unit[eé]s?|cartons?|\d+/.test(t)) return false;
  return /achet/.test(t);
}

const cases = [];
function check(name, cond) {
  cases.push({ name, ok: Boolean(cond) });
}

// TEST 1
check('T1 nouveau produit → missing prices', missingSlots('produit', 'ajouter', { nom: 'chocolat' }).join() === 'prix_achat,prix_vente');

// TEST 2
check(
  'T2 both prices → ready for confirm',
  missingSlots('produit', 'ajouter', { nom: 'chocolat', prix_achat: 1, prix_vente: 1.5 }).length === 0,
);

// TEST 3
check('T3 stock receive → has produit+qty', missingSlots('stock', 'ajouter', { produit: 'chocolat', quantite: 50 }).length === 0);

// TEST 4
check(
  'T4 vente complete',
  missingSlots('vente', '', { produit: 'chocolat', quantite: 10, prix_unitaire: 2 }).length === 0,
);

// TEST 5
check('T5 depense 20$ → missing libelle', missingSlots('depense', '', { montant_total: 20 }).join() === 'libelle');

// TEST 6
check(
  'T6 depense transport complete',
  missingSlots('depense', '', { montant_total: 20, libelle: 'Transport' }).length === 0,
);

// TEST 7
check('T7 ambiguous buy', looksAmbiguousBuy("J'ai acheté du chocolat") === true);
check('T7 not ambiguous with qty', looksAmbiguousBuy("J'ai reçu 30 chocolats") === false);

// TEST 8
check('T8 stock without product', missingSlots('stock', 'ajouter', { quantite: 30 }).join() === 'produit');

// TEST 9
check('T9 vente without qty', missingSlots('vente', '', { produit: 'chocolat' }).includes('quantite'));

// TEST 10 — rule: recherche must not invent numbers (logic check only)
check('T10 never invent: null prix stays missing', missingSlots('produit', 'ajouter', { nom: 'x', prix_achat: null, prix_vente: null }).length === 2);

// Never write with zeros invented
check('Never treat 0 as valid price', hasPositive(0) === false);

const failed = cases.filter((c) => !c.ok);
console.log(cases.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n'));
console.log(failed.length ? `\n${failed.length} failed` : `\nAll ${cases.length} offline checks passed`);
process.exit(failed.length ? 1 : 0);
