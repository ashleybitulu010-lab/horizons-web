/** Deterministic numeric helpers for financial analysis. */

export function isFiniteNumber(value) {
	return typeof value === 'number' && Number.isFinite(value);
}

export function roundMoney(value) {
	if (!isFiniteNumber(value)) return null;
	return Number(value.toFixed(2));
}

export function assertSafeNumber(value) {
	if (!isFiniteNumber(value)) return null;
	if (!Number.isFinite(value)) return null;
	return value;
}
