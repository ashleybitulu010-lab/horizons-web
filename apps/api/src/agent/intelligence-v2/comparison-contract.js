import { validatePeriodSpec } from './period-contract.js';
import { COMPARISON_METRICS } from './constants.js';

export function validateComparisonSpec(raw) {
	if (raw == null) {
		return { valid: true, value: null };
	}

	if (typeof raw !== 'object') {
		return { valid: false, error: 'COMPARISON_INVALID' };
	}

	if (raw.enabled === false) {
		return { valid: true, value: { enabled: false } };
	}

	const enabled = raw.enabled !== false;
	const metric = raw.metric == null ? 'GENERAL' : String(raw.metric);
	if (!COMPARISON_METRICS.includes(metric)) {
		return { valid: false, error: 'COMPARISON_METRIC_INVALID' };
	}

	const leftActivityReference = raw.leftActivityReference != null
		? String(raw.leftActivityReference).trim()
		: null;
	const rightActivityReference = raw.rightActivityReference != null
		? String(raw.rightActivityReference).trim()
		: null;

	let leftPeriod = null;
	if (raw.leftPeriod != null) {
		const leftResult = validatePeriodSpec(raw.leftPeriod);
		if (!leftResult.valid) {
			return { valid: false, error: `COMPARISON_LEFT_${leftResult.error}` };
		}
		leftPeriod = leftResult.value;
	}

	let rightPeriod = null;
	if (raw.rightPeriod != null) {
		const rightResult = validatePeriodSpec(raw.rightPeriod);
		if (!rightResult.valid) {
			return { valid: false, error: `COMPARISON_RIGHT_${rightResult.error}` };
		}
		rightPeriod = rightResult.value;
	}

	const hasPeriodComparison = Boolean(leftPeriod && rightPeriod);
	const hasActivityComparison = Boolean(leftActivityReference && rightActivityReference);
	if (!hasPeriodComparison && !hasActivityComparison) {
		return { valid: false, error: 'COMPARISON_TARGET_MISSING' };
	}

	const value = {
		enabled,
		leftPeriod,
		rightPeriod,
		metric,
	};

	if (leftActivityReference) {
		value.leftActivityReference = leftActivityReference;
	}
	if (rightActivityReference) {
		value.rightActivityReference = rightActivityReference;
	}

	return { valid: true, value };
}

export function buildPeriodComparison(leftPeriod, rightPeriod, metric = 'GENERAL') {
	const leftResult = validatePeriodSpec(leftPeriod);
	const rightResult = validatePeriodSpec(rightPeriod);
	if (!leftResult.valid || !rightResult.valid) {
		return null;
	}

	return {
		enabled: true,
		leftPeriod: leftResult.value,
		rightPeriod: rightResult.value,
		metric,
	};
}

export function buildActivityComparison(leftActivityReference, rightActivityReference, metric = 'GENERAL') {
	if (!leftActivityReference || !rightActivityReference) {
		return null;
	}

	return {
		enabled: true,
		leftActivityReference: String(leftActivityReference).trim(),
		rightActivityReference: String(rightActivityReference).trim(),
		metric,
		leftPeriod: null,
		rightPeriod: null,
	};
}
