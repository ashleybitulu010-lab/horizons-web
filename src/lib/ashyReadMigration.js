/**
 * H12.1 + H12.2 + H12.3 + H12.4 + H12.5 + H12.6 — incremental Legacy → V2 read migration (one capability at a time).
 * Rollback SALES: VITE_ASHY_READ_SALES=false
 * Rollback EXPENSES: VITE_ASHY_READ_EXPENSES=false
 * Rollback STOCK: VITE_ASHY_READ_STOCK=false
 * Rollback PRODUCTS: VITE_ASHY_READ_PRODUCTS=false
 * Rollback DEBTS: VITE_ASHY_READ_DEBTS=false
 * Rollback PROFIT: VITE_ASHY_READ_PROFIT=false
 * Rollback REPORT: VITE_ASHY_READ_REPORT=false
 */

export const READ_CAPABILITY = Object.freeze({
  SALES: 'SALES',
  EXPENSES: 'EXPENSES',
  STOCK: 'STOCK',
  PRODUCTS: 'PRODUCTS',
  DEBTS: 'DEBTS',
  PROFIT: 'PROFIT',
  REPORT: 'REPORT',
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

/** H12.4 fourth migrated READ. Default OFF; explicit true enables. */
export function isAshyReadProductsMigrated(env = import.meta.env) {
  return String(env?.VITE_ASHY_READ_PRODUCTS || '').toLowerCase() === 'true';
}

/** H12.5 fifth migrated READ. Default OFF; explicit true enables. */
export function isAshyReadDebtsMigrated(env = import.meta.env) {
  return String(env?.VITE_ASHY_READ_DEBTS || '').toLowerCase() === 'true';
}

/** H12.6 sixth migrated READ (Profit/Analysis). Default OFF; explicit true enables. */
export function isAshyReadProfitMigrated(env = import.meta.env) {
  return String(env?.VITE_ASHY_READ_PROFIT || '').toLowerCase() === 'true';
}

/** H12.8 seventh migrated READ (Report text). Default OFF; explicit true enables. */
export function isAshyReadReportMigrated(env = import.meta.env) {
  return String(env?.VITE_ASHY_READ_REPORT || '').toLowerCase() === 'true';
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

const PRODUCT_CATALOG_READ_EXCLUSION = /\b(vendu|vente|d[eé]pens|b[eé]n[eé]f|stock|reste|[eé]puis|mieux|plus vendu|presque)\b/i;

const PRODUCTS_READ_PATTERNS = [
  /^(?:quels?|liste(?:r|z)?|montre(?:-moi|-\s)?|donne(?:-moi|-\s)?(?:\s+la\s+liste\s+de)?|affiche).*(?:mes\s+)?produits/i,
  /^mes produits/i,
  /(?:quels?|liste).*(?:mes\s+)?produits\s*\??$/i,
  /mon catalogue/i,
  /mes articles/i,
  /quels produits (?:ai-je|je vends|sont enregistr)/i,
  /\bcombien de produits\b/i,
];

function isProductsWriteOpener(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^ajoute(?:r|z)?\s+(?:un\s+)?(?:nouveau\s+)?produit/i.test(t)) return true;
  if (/^cr[eé][eé](?:r|z)?\s+(?:un\s+)?(?:nouveau\s+)?produit/i.test(t)) return true;
  if (/^enregistre(?:r|z)?\s+(?:un\s+)?(?:nouveau\s+)?produit/i.test(t)) return true;
  if (/^modifi(?:e|er|é)\s+(?:le\s+)?(?:prix\s+(?:du\s+)?)?produit/i.test(t)) return true;
  if (/^modifi(?:e|er|é)\s+(?:le\s+)?prix\s+du/i.test(t)) return true;
  if (/^change(?:r|z)?\s+(?:le\s+)?prix\s+(?:du\s+)?produit/i.test(t)) return true;
  if (/^supprime(?:r|z)?\s+(?:le\s+)?produit/i.test(t)) return true;
  if (/^retire(?:r|z)?\s+(?:ce\s+)?produit/i.test(t)) return true;
  if (/^je veux ajouter un nouveau produit/i.test(t)) return true;
  return false;
}

const DEBTS_READ_PATTERNS = [
  /^quelles?\s+(?:sont\s+)?(?:mes\s+)?dettes/i,
  /^montre(?:-moi)?(?:\s+(?:mes|les))?\s+dettes/i,
  /^(?:et\s+)?(?:mes|les)\s+dettes\s*\??$/i,
  /^mes dettes/i,
  /qui me doit/i,
  /combien.*me\s+doiv/i,
  /combien me doit/i,
  /me doivent|doit encore|doivent encore/i,
  /dettes?\s*(?:clients?)/i,
  /ai-je des dettes/i,
  /montre.*dettes/i,
  /quel(?:le)?s?\s+(?:sont\s+)?(?:mes\s+)?clients?\s+d[eé]biteurs/i,
  /donne(?:-moi)?(?:\s+la\s+liste\s+(?:des\s+)?)?d[eé]biteurs/i,
  /liste.*d[eé]biteurs/i,
  /total.*(?:mes\s+)?dettes/i,
  /montre.*dettes.*clients/i,
];

function isDebtsWriteOpener(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^j['']?ai pay[eé]/i.test(t) && /\bdette/i.test(t)) return true;
  if (/^j['']?ai re[cç]u un paiement/i.test(t)) return true;
  if (/^enregistre(?:r|z)?\s+(?:le\s+)?paiement/i.test(t)) return true;
  if (/^ajoute(?:r|z)?\s+(?:un\s+)?paiement/i.test(t)) return true;
  if (/^ajoute(?:r|z)?\s+une\s+dette/i.test(t)) return true;
  if (/^cr[eé][eé](?:r|z)?\s+une\s+dette/i.test(t)) return true;
  if (/^modifi(?:e|er|é)\s+(?:la\s+)?dette/i.test(t)) return true;
  if (/^supprime(?:r|z)?\s+(?:cette\s+)?dette/i.test(t)) return true;
  if (/le client a pay[eé]/i.test(t)) return true;
  return false;
}

/**
 * Sales READ only — excludes write openers and generic write intents.
 */
export function isSalesReadIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isSalesWriteOpener(t)) return false;
  if ((/[ée]volu(?:e|ent|tion)|evolution|compare/i.test(t) || /comment/i.test(t)) && /chiffre d['']affaires/i.test(t)) {
    return false;
  }
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

/**
 * Products catalog READ only — excludes writes and stock/sales overlap.
 */
export function isProductsReadIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isProductsWriteOpener(t)) return false;
  if (isStockWriteOpener(t)) return false;
  if (isSalesWriteOpener(t)) return false;
  if (PRODUCT_CATALOG_READ_EXCLUSION.test(t)) return false;
  return PRODUCTS_READ_PATTERNS.some((pattern) => pattern.test(t));
}

/**
 * Debts READ only — excludes debt/payment writes and expense overlap.
 */
export function isDebtsReadIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isDebtsWriteOpener(t)) return false;
  if (isSalesWriteOpener(t)) return false;
  if (isExpensesWriteOpener(t)) return false;
  if (/\bd[eé]penses?\b/i.test(t)) return false;
  if (/^un client me doit\b/i.test(t)) return false;
  return DEBTS_READ_PATTERNS.some((pattern) => pattern.test(t));
}

const PROFIT_READ_PATTERNS = [
  /^quel(?:le)?s?\s+(?:est\s+)?(?:mon|mes|le|la)\s+(?:b[eé]n[eé]fice|profit)/i,
  /^combien ai-?je gagn[eé]/i,
  /est-ce que j['']?ai fait du b[eé]n[eé]fice/i,
  /^analyse mes r[eé]sultats/i,
  /^comment vont mes finances/i,
  /pourquoi mon b[eé]n[eé]fice/i,
  /pourquoi mes r[eé]sultats/i,
  /compare.*(?:mon\s+)?b[eé]n[eé]f|compare.*profit/i,
  /(?:mon\s+)?b[eé]n[eé]fice.*(?:augment|mois|pass[eé])/i,
  /quelle est ma marge/i,
  /marge b[eé]n[eé]ficiaire/i,
  /(?:pourcentage|ratio).*revenus?.*d[eé]penses?/i,
  /d[eé]penses?.*revenus?.*(?:pourcentage|ratio)/i,
  /ratio.*d[eé]pense.*revenu/i,
  /(?:[ée]volu[eé]|evolution).*(?:b[eé]n[eé]f|profit)/i,
  /comment va(?:ient)?\s+(?:mon|ma|mes)\s+(?:activit[eé]|commerce|boutique)/i,
  /^fais(?:-|\s)?moi le point/i,
  /^donne(?:-|\s)?moi un r[eé]sum[eé](?:\s*$|[.?!]\s*$)/i,
  /compare.*(?:d[eé]penses?.*revenus?|revenus?.*d[eé]penses?|ventes?.*d[eé]penses?)/i,
];

const REPORT_READ_PATTERNS = [
  /^fais(?:-|\s)?moi\s+(?:un\s+)?rapport(?:\s+financier)?\b/i,
  /^fais(?:-|\s)?moi\s+(?:(?:un|le)\s+)?bilan\b/i,
  /^donne(?:-|\s)?moi\s+(?:(?:un|le)\s+)?bilan\b/i,
  /^donne(?:-|\s)?moi\s+un\s+bilan\s+(?:de\s+)?(?:mon\s+)?activit[eé]/i,
  /^fais(?:-|\s)?moi\s+le\s+r[eé]sum[eé]\s+(?:de\s+)?(?:mon\s+)?activit[eé]/i,
  /^(?:fais(?:-|\s)?moi\s+)?(?:le\s+)?r[eé]sum[eé]\s+(?:de\s+)?(?:mon\s+)?activit[eé]/i,
  /^(?:donne(?:-|\s)?moi\s+)?(?:un\s+)?r[eé]sum[eé]\s+financier/i,
  /^je\s+peux\s+avoir\s+(?:mon\s+)?bilan\b/i,
  /^fais(?:-|\s)?moi\s+(?:le\s+)?r[eé]cap(?:itulatif)?\b/i,
  /^donne(?:-|\s)?moi\s+(?:le\s+)?r[eé]cap(?:itulatif)?\b/i,
];

function isProfitSalesOrExpensesOnlyQuery(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^combien ai-?je vendu/i.test(t)) return true;
  if (/^combien ai-?je d[eé]pens[eé]/i.test(t)) return true;
  if (/^quelles sont mes ventes/i.test(t)) return true;
  if (/^quelles sont mes d[eé]penses/i.test(t)) return true;
  if ((/[ée]volu[eé]|evolution|compare/i.test(t) || /^comment/i.test(t))
    && /\bventes?\b/i.test(t) && !/b[eé]n[eé]f|profit|marge|revenu|d[eé]pense/i.test(t)) {
    return true;
  }
  if ((/[ée]volu[eé]|evolution|compare/i.test(t) || /^comment/i.test(t))
    && /\bd[eé]penses?\b/i.test(t) && !/b[eé]n[eé]f|profit|marge|ventes?|revenu/i.test(t)) {
    return true;
  }
  if ((/[ée]volu[eé]|evolution/i.test(t) || /comment/i.test(t)) && /chiffre d['']affaires/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Profit / financial analysis READ — excludes sales/expenses-only queries and writes.
 */
export function isProfitReadIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isSalesWriteOpener(t)) return false;
  if (isExpensesWriteOpener(t)) return false;
  if (isStockWriteOpener(t)) return false;
  if (isDebtsWriteOpener(t)) return false;
  if (isProfitSalesOrExpensesOnlyQuery(t)) return false;
  if (isSalesReadIntent(t)) return false;
  if (isExpensesReadIntent(t)) return false;
  if (isStockReadIntent(t)) return false;
  if (isProductsReadIntent(t)) return false;
  if (isDebtsReadIntent(t)) return false;
  return PROFIT_READ_PATTERNS.some((pattern) => pattern.test(t));
}

/**
 * Generic activity report text READ — excludes PDF exports, profit/analysis, and writes.
 */
export function isReportReadIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/\bpdf\b/i.test(t)) return false;
  if (isSalesWriteOpener(t)) return false;
  if (isExpensesWriteOpener(t)) return false;
  if (isStockWriteOpener(t)) return false;
  if (isDebtsWriteOpener(t)) return false;
  if (isProductsWriteOpener(t)) return false;
  if (isProfitReadIntent(t)) return false;
  if (isSalesReadIntent(t)) return false;
  if (isExpensesReadIntent(t)) return false;
  if (isStockReadIntent(t)) return false;
  if (isProductsReadIntent(t)) return false;
  if (isDebtsReadIntent(t)) return false;
  return REPORT_READ_PATTERNS.some((pattern) => pattern.test(t));
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
  if (capability === READ_CAPABILITY.PRODUCTS) {
    return isAshyReadProductsMigrated(env) && isProductsReadIntent(text);
  }
  if (capability === READ_CAPABILITY.DEBTS) {
    return isAshyReadDebtsMigrated(env) && isDebtsReadIntent(text);
  }
  if (capability === READ_CAPABILITY.PROFIT) {
    return isAshyReadProfitMigrated(env) && isProfitReadIntent(text);
  }
  if (capability === READ_CAPABILITY.REPORT) {
    return isAshyReadReportMigrated(env) && isReportReadIntent(text);
  }
  return false;
}
