import { ANALYSIS_DRIVER_TYPES, GOAL_DOMAINS } from './constants.js';
import { validateComparisonSpec } from './comparison-contract.js';

const METRIC_KEYS = Object.freeze([
	'revenue',
	'expenses',
	'profit',
	'salesCount',
	'expenseCount',
	'totalCollected',
	'unpaidDebtTotal',
]);

function isFiniteNumber(value) {
	return typeof value === 'number' && Number.isFinite(value);
}

export function validateAnalysisDriver(raw) {
	if (!raw || typeof raw !== 'object') {
		return { valid: false, error: 'DRIVER_INVALID' };
	}

	const type = String(raw.type || '');
	if (!ANALYSIS_DRIVER_TYPES.includes(type)) {
		return { valid: false, error: 'DRIVER_TYPE_INVALID' };
	}

	const label = String(raw.label || '').slice(0, 128);
	if (!label) {
		return { valid: false, error: 'DRIVER_LABEL_REQUIRED' };
	}

	for (const key of ['currentValue', 'previousValue', 'delta', 'contribution']) {
		if (raw[key] != null && !isFiniteNumber(raw[key])) {
			return { valid: false, error: 'DRIVER_NUMERIC_INVALID' };
		}
	}

	return {
		valid: true,
		value: {
			type,
			label,
			currentValue: raw.currentValue ?? null,
			previousValue: raw.previousValue ?? null,
			delta: raw.delta ?? null,
			contribution: raw.contribution ?? null,
		},
	};
}

export function validateAnalysisResult(raw) {
	if (!raw || typeof raw !== 'object') {
		return { valid: false, error: 'RESULT_INVALID' };
	}

	const success = Boolean(raw.success);
	const domain = raw.domain == null ? null : String(raw.domain);
	if (domain && !GOAL_DOMAINS.includes(domain)) {
		return { valid: false, error: 'RESULT_DOMAIN_INVALID' };
	}

	const metrics = {};
	if (raw.metrics && typeof raw.metrics === 'object') {
		for (const key of Object.keys(raw.metrics)) {
			if (!METRIC_KEYS.includes(key)) {
				return { valid: false, error: 'RESULT_METRIC_UNKNOWN' };
			}
			const value = raw.metrics[key];
			if (value != null && !isFiniteNumber(value)) {
				return { valid: false, error: 'RESULT_METRIC_INVALID' };
			}
			metrics[key] = value ?? null;
		}
	}

	let comparison = null;
	if (raw.comparison != null) {
		const comparisonResult = validateComparisonSpec(raw.comparison);
		if (!comparisonResult.valid) {
			return { valid: false, error: comparisonResult.error };
		}
		comparison = comparisonResult.value;
	}

	const drivers = [];
	if (Array.isArray(raw.drivers)) {
		for (const driver of raw.drivers) {
			const driverResult = validateAnalysisDriver(driver);
			if (!driverResult.valid) {
				return { valid: false, error: driverResult.error };
			}
			drivers.push(driverResult.value);
		}
	}

	const warnings = Array.isArray(raw.warnings)
		? raw.warnings.map((w) => String(w).slice(0, 256))
		: [];

	const sourceSteps = Array.isArray(raw.sourceSteps)
		? raw.sourceSteps.map((s) => String(s))
		: [];

	return {
		valid: true,
		value: {
			success,
			domain,
			metrics,
			comparison,
			drivers,
			warnings,
			sourceSteps,
		},
	};
}

/**
 * Build AnalysisResult from backend tool summaries only.
 * Numbers must originate from toolResults — never from LLM output.
 */
export function buildAnalysisResultFromToolSummaries({
	domain,
	toolResults = [],
	comparison = null,
	referenceDate = new Date(),
}) {
	const metrics = {};
	const sourceSteps = [];
	const warnings = [];

	for (const result of toolResults) {
		if (!result?.success) {
			warnings.push(`Step ${result?.tool || 'unknown'} failed`);
			continue;
		}

		sourceSteps.push(result.tool);
		const summary = result.data?.summary || {};

		if (result.tool === 'get_sales' || summary.totalRevenue != null) {
			if (summary.totalRevenue != null) metrics.revenue = summary.totalRevenue;
			if (summary.totalCollected != null) metrics.totalCollected = summary.totalCollected;
			if (summary.count != null) metrics.salesCount = summary.count;
		}
		if (result.tool === 'get_expenses' || summary.totalAmount != null) {
			if (summary.totalAmount != null) metrics.expenses = summary.totalAmount;
			if (summary.count != null) metrics.expenseCount = summary.count;
		}
		if (summary.estimatedProfit != null) {
			metrics.profit = summary.estimatedProfit;
		}
		if (summary.unpaidDebtTotal != null) {
			metrics.unpaidDebtTotal = summary.unpaidDebtTotal;
		}
	}

	if (metrics.totalCollected != null && metrics.expenses != null && metrics.profit == null) {
		metrics.profit = Number((metrics.totalCollected - metrics.expenses).toFixed(2));
	}

	return validateAnalysisResult({
		success: warnings.length === 0,
		domain: domain || 'PROFIT',
		metrics,
		comparison,
		drivers: [],
		warnings,
		sourceSteps,
	});
}

/** Reject LLM-originated numbers masquerading as analysis results. */
export function assertAnalysisResultFromBackendOnly(result, allowedSourceSteps) {
	if (!result?.valid) {
		return false;
	}
	const steps = result.value.sourceSteps || [];
	return steps.every((step) => allowedSourceSteps.includes(step));
}
