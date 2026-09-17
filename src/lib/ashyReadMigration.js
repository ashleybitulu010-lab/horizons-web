/**
 * H12.1 + H12.2 + H12.3 — incremental Legacy → V2 read migration (one capability at a time).
 * Rollback SALES: VITE_ASHY_READ_SALES=false
 * Rollback EXPENSES: VITE_ASHY_READ_EXPENSES=false
 * Rollback STOCK: VITE_ASHY_READ_STOCK=false
 */

export const READ_CAPABILITY = Object.freeze({
  SALES: 'SALES',
  EXPENSES: 'EXPENSES',
  STOCK: 'STOCK',
});

const CREATE_SALE_PREFIX = /^j['']?ai vendu\b/i;
const CREATE_EXPENSE_PREFIX = /^j['']?ai d[eé]pens[eé]/i;
const STOCK_RECEIVED_PREFIX = /^j['']?ai re[cç]u\b/i;

function isSalesWriteOpener(text) {
  const t = String(text || '').trim();
  if (!t || /^combien/i.test(t)) return false;
  return CREATE_SALE_PREFIX.test(t) || /^j['']?ai fait une vente\b/i.test(t);
}

function isExpensesWriteOpener(text) {
  const t = String(text || '').trim();
  if (!t || /^combien/i.test(t)) return false;
  return CREATE_EXPENSE_PREFIX.test(t);
}

function isStockWriteOpener(text) {
  const t = String(text || '').trim();
  if (!t || /^(?:combien|quel)/i.test(t)) return false;
  if (STOCK_RECEIVED_PREFIX.test(t)) return true;
  if (/^ajoute(?:r|z)?\s+\d+/i.test(t) && /\b(stock|produit|unit[eé]|poulet|kg|bo[iî]te)/i.test(t)) return true;
  if (/^(?:retire(?:r|z)?|enl[eè]ve(?:r|z)?)\s+\d+/i.test(t)) return true;
  if (/^(?:retire(?:r|z)?|enl[eè]ve(?:r|z)?)\b/i.test(t) && /\b(stock|produit|poulet|unit[eé])/i.test(t)) return true;
  if (/^(?:corrige(?:r|z)?|modifie(?:r|z)?)\b/i.test(t) && /\bstock\b/i.test(t)) return true;
  return false;
}

/** H12.1 first migrated READ. Default ON; explicit false disables (rollback). */
export function isAshyReadSalesMigrated(env = import.meta.env) {
  const raw = env?.VITE_ASHY_READ_SALES;
  if (raw === undefined || raw === null || raw === '') return true;
  return String(raw).toLowerCase() === 'true';
}

/** H12.2 second migrated READ. Default OFF; explicit true enables. */
export function isAshyReadExpensesMigrated(env = import.meta.env) {
  return String(env?.VITE_ASHY_READ_EXPENSES || '').toLowerCase() === 'true';
}

/** H12.3 third migrated READ. Default OFF; explicit true enables. */
export function isAshyReadStockMigrated(env = import.meta.env) {
  return String(env?.VITE_ASHY_READ_STOCK || '').toLowerCase() === 'true';
}

const SALES_READ_PATTERNS = [
  /^quelles sont mes ventes/i,
  /^(?:et\s+)?(?:mes|les)\s+ventes\s*\??$/i,
  /^combien ai-?je vendu/i,
  /combien.*(?:de\s+)?ventes/i,
  /(?:mon|mes)\s+chiffre d['']affaires/i,
  /produit.*(?:mieux|plus).*vendu/i,
  /meilleur\s+produit/i,
];

const EXPENSES_READ_PATTERNS = [
  /^quelles sont mes d[eé]penses/i,
  /^montre(?:-moi)? mes d[eé]penses/i,
  /^combien ai-?je d[eé]pens[eé]/i,
  /^(?:et\s+)?(?:mes|les)\s+d[eé]penses\s*\??$/i,
  /^(?:montre|donne|affiche)(?:-moi)?(?:\s+les)?\s+(?:mes\s+)?d[eé]penses/i,
];

const STOCK_READ_PATTERNS = [
  /^quel(?:le)?s?\s+(?:est\s+)?(?:mon|mes|le|la)\s+stock/i,
  /^quel(?:le)?s?\s+(?:sont\s+)?(?:mes|les)\s+stocks?\s*\??$/i,
  /^montre(?:-moi)?(?:\s+(?:mon|mes))?\s+stock/i,
  /^(?:et\s+)?(?:mes|les)\s+stocks?\s*\??$/i,
  /^combien\s+(?:me\s+)?reste/i,
  /reste[- ]?t[- ]?il\s+de/i,
  /quels?\s+produits?\s+(?:me\s+)?restent/i,
  /(?:mon|l[''])(?:état|etat)\s+(?:de\s+)?(?:mon\s+)?stock/i,
  /(?:produits?\s+)?(?:presque\s+)?(?:[eé]puis|[eé]puis[eé]|stock\s+faible)/i,
  /^il\s+me\s+reste\s+combien/i,
];

/**
 * Sales READ only — excludes write openers and generic write intents.
 */
export function isSalesReadIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isSalesWriteOpener(t)) return false;
  return SALES_READ_PATTERNS.some((pattern) => pattern.test(t));
}

/**
 * Expenses READ only — excludes write openers (j'ai dépensé, ajoute dépense).
 */
export function isExpensesReadIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isExpensesWriteOpener(t)) return false;
  if (/^ajoute(?:r|z)?\s+(?:une\s+)?d[eé]pense/i.test(t)) return false;
  if (/^enregistre(?:r|z)?\s+(?:une\s+)?d[eé]pense/i.test(t)) return false;
  return EXPENSES_READ_PATTERNS.some((pattern) => pattern.test(t));
}

/**
 * Stock READ only — excludes stock writes/adjustments and sale openers.
 */
export function isStockReadIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isStockWriteOpener(t)) return false;
  if (isSalesWriteOpener(t)) return false;
  if (/^ajoute(?:r|z)?\s+\d+/i.test(t)) return false;
  if (/^(?:retire(?:r|z)?|enl[eè]ve(?:r|z)?)\b/i.test(t)) return false;
  if (/^(?:corrige(?:r|z)?|modifie(?:r|z)?)\b/i.test(t) && /\bstock\b/i.test(t)) return false;
  if (/^liste(?:r|z)?\s+(?:mes\s+)?produits/i.test(t)) return false;
  if (/^(?:mes|les)\s+produits\s*\??$/i.test(t) && !/restent/i.test(t)) return false;
  return STOCK_READ_PATTERNS.some((pattern) => pattern.test(t));
}

export function isMigratedReadIntent(capability, text, env = import.meta.env) {
  if (capability === READ_CAPABILITY.SALES) {
    return isAshyReadSalesMigrated(env) && isSalesReadIntent(text);
  }
  if (capability === READ_CAPABILITY.EXPENSES) {
    return isAshyReadExpensesMigrated(env) && isExpensesReadIntent(text);
  }
  if (capability === READ_CAPABILITY.STOCK) {
    return isAshyReadStockMigrated(env) && isStockReadIntent(text);
  }
  return false;
}
