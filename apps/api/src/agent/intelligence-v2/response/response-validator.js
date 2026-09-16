import { detectUnsafeResponseContent } from './response-sanitizer.js';

const WRITE_CLAIM_PATTERNS = [
	/\bj['’]?ai ajouté\b/i,
	/\bajouté ta dépense\b/i,
	/\bj['’]?ai enregistré ta dépense\b/i,
	/\bj['’]?ai créé la vente\b/i,
	/\btransaction effectuée\b/i,
	/\bécriture confirmée\b/i,
];

const CERTAIN_CAUSE_PATTERNS = [
	/\bla cause certaine\b/i,
	/\bpreuve absolue\b/i,
	/\b100 % sûr\b/i,
];

function collectAllowedNumbers(analysis) {
	const allowed = new Set();

	function add(value) {
		if (value == null || !Number.isFinite(Number(value))) return;
		const num = Number(value);
		allowed.add(num);
		allowed.add(Number(num.toFixed(2)));
		allowed.add(Math.abs(num));
		allowed.add(Math.abs(Number(num.toFixed(2))));
	}

	function walk(obj) {
		if (obj == null) return;
		if (typeof obj === 'number') {
			add(obj);
			return;
		}
		if (Array.isArray(obj)) {
			for (const item of obj) walk(item);
			return;
		}
		if (typeof obj === 'object') {
			for (const value of Object.values(obj)) walk(value);
		}
	}

	walk(analysis?.metrics);
	walk(analysis?.comparisons);
	walk(analysis?.facts);
	walk(analysis?.drivers);
	walk(analysis?.ratios);

	return allowed;
}

function normalizeNumberToken(token) {
	return Number(String(token).replace(/\s/g, '').replace(',', '.'));
}

export function extractFinancialNumbers(text) {
	const results = [];
	const value = String(text || '');

	const percentMatches = value.matchAll(/(-?\d[\d\s.,]*)\s*%/g);
	for (const match of percentMatches) {
		const num = normalizeNumberToken(match[1]);
		if (Number.isFinite(num)) results.push({ type: 'percent', value: num });
	}

	const moneyMatches = value.matchAll(/(-?\d[\d\s.,]*)\s*\$/g);
	for (const match of moneyMatches) {
		const num = normalizeNumberToken(match[1]);
		if (Number.isFinite(num)) results.push({ type: 'money', value: num });
	}

	return results;
}

function isAllowedNumber(value, allowed) {
	for (const candidate of allowed) {
		if (Math.abs(candidate - value) < 0.02) return true;
	}
	return false;
}

export function validateNumericClaims(text, analysis) {
	const allowed = collectAllowedNumbers(analysis);
	const extracted = extractFinancialNumbers(text);
	const unauthorized = [];

	for (const item of extracted) {
		if (!isAllowedNumber(item.value, allowed)) {
			unauthorized.push(item);
		}
	}

	return {
		valid: unauthorized.length === 0,
		unauthorized,
		allowedCount: allowed.size,
	};
}

export function validateClaimsAgainstAnalysis(text, analysis) {
	const issues = [];
	const lower = String(text || '').toLowerCase();

	const profitDirection = analysis?.comparisons?.profit?.direction;
	if (profitDirection === 'DOWN' && /\b(bénéfice|profit)\b[^.!?]{0,80}\b(augment|progress|monte|hausse)\b/i.test(lower)) {
		issues.push('PROFIT_DIRECTION_MISMATCH');
	}
	if (profitDirection === 'UP' && /\b(bénéfice|profit)\b[^.!?]{0,80}\b(baiss|diminu|descend|perte accrue)\b/i.test(lower)) {
		issues.push('PROFIT_DIRECTION_MISMATCH');
	}

	const revenueDirection = analysis?.comparisons?.revenue?.direction;
	if (revenueDirection === 'DOWN' && /\b(ventes|revenus?)\b[^.!?]{0,80}\b(augment|progress|monte)\b/i.test(lower)) {
		issues.push('REVENUE_DIRECTION_MISMATCH');
	}
	if (revenueDirection === 'UP' && /\b(ventes|revenus?)\b[^.!?]{0,80}\b(baiss|diminu|descend)\b/i.test(lower)) {
		issues.push('REVENUE_DIRECTION_MISMATCH');
	}

	const expenseDirection = analysis?.comparisons?.expenses?.direction;
	if (expenseDirection === 'DOWN' && /\b(dépenses?)\b[^.!?]{0,80}\b(augment|progress|monte|doubl)\b/i.test(lower)) {
		issues.push('EXPENSE_DIRECTION_MISMATCH');
	}
	if (expenseDirection === 'UP' && /\b(dépenses?)\b[^.!?]{0,80}\b(baiss|diminu|descend|réduit)\b/i.test(lower)) {
		issues.push('EXPENSE_DIRECTION_MISMATCH');
	}

	for (const pattern of WRITE_CLAIM_PATTERNS) {
		if (pattern.test(text)) {
			issues.push('WRITE_CLAIM_FORBIDDEN');
		}
	}

	for (const pattern of CERTAIN_CAUSE_PATTERNS) {
		if (pattern.test(text)) {
			issues.push('CERTAIN_CAUSE_FORBIDDEN');
		}
	}

	return {
		valid: issues.length === 0,
		issues,
	};
}

export function validateGeneratedResponseText(text, analysis, options = {}) {
	if (!text || !String(text).trim()) {
		return { valid: false, error: 'EMPTY_TEXT' };
	}

	const safety = detectUnsafeResponseContent(text);
	if (!safety.safe) {
		return { valid: false, error: safety.reason };
	}

	if (options.skipNumericValidation) {
		return { valid: true };
	}

	const numeric = validateNumericClaims(text, analysis);
	if (!numeric.valid) {
		return { valid: false, error: 'UNAUTHORIZED_NUMBER', details: numeric.unauthorized };
	}

	const claims = validateClaimsAgainstAnalysis(text, analysis);
	if (!claims.valid) {
		return { valid: false, error: 'CLAIM_MISMATCH', details: claims.issues };
	}

	return { valid: true };
}
