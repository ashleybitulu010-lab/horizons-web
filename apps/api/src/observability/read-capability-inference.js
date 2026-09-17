/**
 * H12.1.1 — Infer READ capability from message text (server-side, no persistence).
 */

export const READ_CAPABILITY = Object.freeze({
	SALES: 'SALES',
	EXPENSES: 'EXPENSES',
	STOCK: 'STOCK',
	PRODUCTS: 'PRODUCTS',
	DEBTS: 'DEBTS',
	PROFIT: 'PROFIT',
	REPORT: 'REPORT',
	HISTORY: 'HISTORY',
	UNKNOWN: 'UNKNOWN',
});

const WRITE_OPENERS = [
	/^j['']?ai vendu\b/i,
	/^j['']?ai d[eé]pens[eé]/i,
	/^j['']?ai re[cç]u\b/i,
	/^je veux ajouter un nouveau produit/i,
];

const CAPABILITY_PATTERNS = [
	{ capability: READ_CAPABILITY.SALES, patterns: [/ventes?\b/i, /vendu/i, /chiffre d['']affaires/i] },
	{ capability: READ_CAPABILITY.EXPENSES, patterns: [/d[eé]penses?\b/i] },
	{ capability: READ_CAPABILITY.STOCK, patterns: [/\bstock\b/i, /catalogue/i] },
	{ capability: READ_CAPABILITY.PRODUCTS, patterns: [/produits?\b/i] },
	{ capability: READ_CAPABILITY.DEBTS, patterns: [/dette/i, /me doit/i, /impay/i] },
	{ capability: READ_CAPABILITY.PROFIT, patterns: [/b[eé]n[eé]fice/i, /profit/i, /marge/i] },
	{ capability: READ_CAPABILITY.REPORT, patterns: [/bilan/i, /rapport/i, /synth[eè]se/i, /r[eé]cap/i, /fais-moi le point/i, /compare/i] },
	{ capability: READ_CAPABILITY.HISTORY, patterns: [/historique/i] },
];

export function mapGoalDomainToCapability(goalDomain, goalObjective) {
	if (!goalDomain) return READ_CAPABILITY.UNKNOWN;
	const domain = String(goalDomain).toUpperCase();
	if (domain === 'SALES') return READ_CAPABILITY.SALES;
	if (domain === 'EXPENSES') return READ_CAPABILITY.EXPENSES;
	if (domain === 'STOCK') return READ_CAPABILITY.STOCK;
	if (domain === 'PRODUCTS') return READ_CAPABILITY.PRODUCTS;
	if (domain === 'DEBTS') return READ_CAPABILITY.DEBTS;
	if (domain === 'PROFIT') return READ_CAPABILITY.PROFIT;
	if (domain === 'GENERAL') {
		if (goalObjective === 'COMPARE') return READ_CAPABILITY.REPORT;
		return READ_CAPABILITY.REPORT;
	}
	return READ_CAPABILITY.UNKNOWN;
}

export function inferReadCapabilityFromMessage(message) {
	const t = String(message || '').trim();
	if (!t) return READ_CAPABILITY.UNKNOWN;
	if (WRITE_OPENERS.some((p) => p.test(t))) return READ_CAPABILITY.UNKNOWN;
	for (const { capability, patterns } of CAPABILITY_PATTERNS) {
		if (patterns.some((p) => p.test(t))) return capability;
	}
	return READ_CAPABILITY.UNKNOWN;
}

export function isLikelyReadMessage(message) {
	const t = String(message || '').trim();
	if (!t || WRITE_OPENERS.some((p) => p.test(t))) return false;
	return CAPABILITY_PATTERNS.some(({ patterns }) => patterns.some((p) => p.test(t)))
		|| /^(combien|quel(?:le)?|quels|montre|liste|donne|affiche)\b/i.test(t);
}
