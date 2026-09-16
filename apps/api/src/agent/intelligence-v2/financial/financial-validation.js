import { MISSING_DATA_STATE } from './financial-contract.js';

export function validateCurrencyCompatibility(currentMeta, previousMeta) {
	const currentCurrency = currentMeta?.currency || null;
	const previousCurrency = previousMeta?.currency || null;

	if (!currentCurrency && !previousCurrency) {
		return { valid: true };
	}
	if (currentCurrency && previousCurrency && currentCurrency !== previousCurrency) {
		return {
			valid: false,
			error: MISSING_DATA_STATE.INVALID_INPUT,
			message: 'Incompatible currencies between periods',
		};
	}
	return { valid: true };
}

export function validatePeriodCompatibility(currentPeriod, previousPeriod) {
	if (!currentPeriod?.label || !previousPeriod?.label) {
		return { valid: true, warning: 'PERIOD_LABEL_MISSING' };
	}

	const currentLabel = String(currentPeriod.label);
	const previousLabel = String(previousPeriod.label);

	if (currentLabel === previousLabel) {
		return {
			valid: false,
			error: MISSING_DATA_STATE.INVALID_INPUT,
			message: 'Current and previous periods are identical',
		};
	}

	if (currentPeriod.start && previousPeriod.start && currentPeriod.end && previousPeriod.end) {
		const currentSpan = new Date(currentPeriod.end) - new Date(currentPeriod.start);
		const previousSpan = new Date(previousPeriod.end) - new Date(previousPeriod.start);
		const ratio = Math.max(currentSpan, previousSpan) / Math.min(currentSpan, previousSpan);
		if (ratio > 2.5) {
			return {
				valid: true,
				warning: 'PERIOD_LENGTH_MISMATCH',
			};
		}
	}

	return { valid: true };
}

export function validateFinancialInputs(values) {
	for (const [key, value] of Object.entries(values)) {
		if (value == null) continue;
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			return {
				valid: false,
				error: MISSING_DATA_STATE.INVALID_INPUT,
				field: key,
			};
		}
	}
	return { valid: true };
}
