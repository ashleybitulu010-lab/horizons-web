/**
 * H12.1 + H12.2 — incremental Legacy → V2 read migration (one capability at a time).
 * Rollback SALES: VITE_ASHY_READ_SALES=false
 * Rollback EXPENSES: VITE_ASHY_READ_EXPENSES=false
 */

export const READ_CAPABILITY = Object.freeze({
  SALES: 'SALES',
  EXPENSES: 'EXPENSES',
});

const CREATE_SALE_PREFIX = /^j['']?ai vendu\b/i;
const CREATE_EXPENSE_PREFIX = /^j['']?ai d[eé]pens[eé]/i;

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

export function isMigratedReadIntent(capability, text, env = import.meta.env) {
  if (capability === READ_CAPABILITY.SALES) {
    return isAshyReadSalesMigrated(env) && isSalesReadIntent(text);
  }
  if (capability === READ_CAPABILITY.EXPENSES) {
    return isAshyReadExpensesMigrated(env) && isExpensesReadIntent(text);
  }
  return false;
}
