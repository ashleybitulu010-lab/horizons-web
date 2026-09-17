/**
 * H12.1 — incremental Legacy → V2 read migration (one capability at a time).
 * Rollback: set VITE_ASHY_READ_SALES=false and rebuild frontend.
 */

export const READ_CAPABILITY = Object.freeze({
  SALES: 'SALES',
});

const CREATE_SALE_PREFIX = /^j['']?ai vendu\b/i;

function isSalesWriteOpener(text) {
  const t = String(text || '').trim();
  if (!t || /^combien/i.test(t)) return false;
  return CREATE_SALE_PREFIX.test(t) || /^j['']?ai fait une vente\b/i.test(t);
}

/** H12.1 first migrated READ. Default ON; explicit false disables (rollback). */
export function isAshyReadSalesMigrated(env = import.meta.env) {
  const raw = env?.VITE_ASHY_READ_SALES;
  if (raw === undefined || raw === null || raw === '') return true;
  return String(raw).toLowerCase() === 'true';
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

/**
 * Sales READ only — excludes write openers and generic write intents.
 */
export function isSalesReadIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isSalesWriteOpener(t)) return false;
  return SALES_READ_PATTERNS.some((pattern) => pattern.test(t));
}

export function isMigratedReadIntent(capability, text, env = import.meta.env) {
  if (capability === READ_CAPABILITY.SALES) {
    return isAshyReadSalesMigrated(env) && isSalesReadIntent(text);
  }
  return false;
}
