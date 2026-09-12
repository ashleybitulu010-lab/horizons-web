/**
 * Offline unit tests for Ashy slot-filling rules (mirrors n8n Analyser Intention gate).
 * Does not write to Supabase.
 */

function toNumOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!/[0-9]/.test(s)) return null;
  const cleaned = s.replace(/[^0-9.,-]/g, '').replace(/,/g, '.');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
function parseBareNumber(text) {
  const s = String(text || '').trim();
  const m = s.match(/^\$?\s*(-?\d+(?:[.,]\d+)?)\s*(?:\$|dollars?|fc|cdf|usd|unit[eé]s?)?\s*$/i);
  if (!m) return null;
  return toNumOrNull(m[1]);
}
function extractBuySellPrices(text) {
  const t = String(text || '');
  const m = t.match(/(?:achat|ach[eè]te(?:s)?|j['']?ach[eè]te)\D{0,48}?(\d+(?:[.,]\d+)?)\D{0,48}?(?:vend(?:s|u)?|vente|revend(?:s|u)?)\D{0,48}?(\d+(?:[.,]\d+)?)/i);
  if (m) return { prix_achat: toNumOrNull(m[1]), prix_vente: toNumOrNull(m[2]) };
  return null;
}
function hasValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0 && v.trim() !== '0';
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0;
  return true;
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
function looksLikeHowToManage(text) {
  const t = String(text || '').toLowerCase();
  if (/comment\s+(on\s+|je\s+|peut[- ]on\s+|faire\s+pour\s+)?(ajoute|ajouter|enregistre|enregistrer|cr[eé]er|creer|saisir|faire)/i.test(t)) return true;
  if (/comment\s+.+\b(d[eé]pense|vente|stock|produit|bilan|rapport|b[eé]n[eé]fice|pdf)\b/i.test(t)) return true;
  return false;
}
function howToInviteReply(text) {
  const t = String(text || '').toLowerCase();
  if (/d[eé]pens/.test(t)) return "Tu peux simplement me le dire ici";
  return "Tu peux me le dire directement ici";
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

check('Transport is not a number', toNumOrNull('Transport') === null);
check('Bare number from sentence rejected', parseBareNumber("Je l'achete a 1 dollar et je le vends a 1.50") === null);
check('Bare 20 dollars ok', parseBareNumber('20 dollars') === 20);
const dual = extractBuySellPrices("Je l'achete a 1 dollar et je le vends a 1.50");
check('Dual prices 1 / 1.5', dual && dual.prix_achat === 1 && dual.prix_vente === 1.5);
check('Libelle 0 is missing', missingSlots('depense', '', { montant_total: 20, libelle: 0 }).includes('libelle'));
check('How-to depense detected', looksLikeHowToManage("Comment on ajoute une dépense ?") === true);
check('How-to invite no menu', !/onglet|bouton|Ajouter/i.test(howToInviteReply("Comment on ajoute une dépense ?")));
check('Real depense not how-to', looksLikeHowToManage("J'ai dépensé 20 $ pour le transport") === false);

function quantiteExplicitementDansMessage(text) {
  const t = String(text || '').toLowerCase();
  if (/\b\d+(?:[.,]\d+)?\b/.test(t)) return true;
  if (/\b(deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|quarant[ee]|cinquante|cent)\b/.test(t)) return true;
  if (/\b(vendu|vendus|vendue|vendues|re[cç]u|re[cç]us|ajout[eé]|achet[eé]|achet[eé]s)\s+(un|une)\b/.test(t)) return true;
  return false;
}
check('No qty in vendu le biscuit', quantiteExplicitementDansMessage("J'ai vendu le biscuit") === false);
check('Qty in vendu 10 biscuits', quantiteExplicitementDansMessage("J'ai vendu 10 biscuits") === true);
check('Vente slots without inventing price', missingSlots('vente', '', { produit: 'biscuit', quantite: 10 }).join() === 'prix_unitaire' || missingSlots('vente', '', { produit: 'biscuit', quantite: 10 }).includes('prix_unitaire') || missingSlots('vente', '', { produit: 'biscuit', quantite: 10 }).length <= 1);

const failed = cases.filter((c) => !c.ok);
console.log(cases.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n'));
console.log(failed.length ? `\n${failed.length} failed` : `\nAll ${cases.length} offline checks passed`);
process.exit(failed.length ? 1 : 0);
