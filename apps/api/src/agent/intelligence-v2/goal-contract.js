import {
	FORBIDDEN_GOAL_KEYS,
	GOAL_DOMAINS,
	GOAL_OBJECTIVES,
	GOAL_TYPES,
	SQL_INJECTION_PATTERN,
	UUID_PATTERN,
} from './constants.js';
import { validateComparisonSpec } from './comparison-contract.js';
import { normalizePeriodSpec, validatePeriodSpec } from './period-contract.js';

function containsForbiddenContent(value) {
	const serialized = JSON.stringify(value);
	if (SQL_INJECTION_PATTERN.test(serialized)) {
		return 'SQL_FORBIDDEN';
	}

	for (const key of FORBIDDEN_GOAL_KEYS) {
		if (serialized.includes(`"${key}"`)) {
			return 'FORBIDDEN_KEY';
		}
	}

	return null;
}

function validateActivityReference(value) {
	if (value == null) {
		return { valid: true, value: null };
	}

	const reference = String(value).trim();
	if (!reference) {
		return { valid: true, value: null };
	}

	if (UUID_PATTERN.test(reference)) {
		return { valid: false, error: 'ACTIVITY_UUID_NOT_ALLOWED' };
	}

	return { valid: true, value: reference };
}

export function createEmptyGoal(overrides = {}) {
	return {
		type: 'QUESTION',
		domain: 'GENERAL',
		objective: 'RETRIEVE',
		period: null,
		comparison: null,
		activityReference: null,
		parameters: {},
		...overrides,
	};
}

export function validateGoal(raw, options = {}) {
	if (!raw || typeof raw !== 'object') {
		return { valid: false, error: 'GOAL_INVALID' };
	}

	const forbidden = containsForbiddenContent(raw);
	if (forbidden) {
		return { valid: false, error: forbidden };
	}

	for (const key of FORBIDDEN_GOAL_KEYS) {
		if (raw[key] != null) {
			return { valid: false, error: 'FORBIDDEN_KEY' };
		}
		if (raw.parameters?.[key] != null) {
			return { valid: false, error: 'FORBIDDEN_PARAMETER' };
		}
	}

	const type = String(raw.type || '');
	if (!GOAL_TYPES.includes(type)) {
		return { valid: false, error: 'GOAL_TYPE_INVALID' };
	}

	const domain = String(raw.domain || '');
	if (!GOAL_DOMAINS.includes(domain)) {
		return { valid: false, error: 'GOAL_DOMAIN_INVALID' };
	}

	const objective = String(raw.objective || '');
	if (!GOAL_OBJECTIVES.includes(objective)) {
		return { valid: false, error: 'GOAL_OBJECTIVE_INVALID' };
	}

	let period = null;
	if (raw.period != null) {
		const periodResult = validatePeriodSpec(raw.period);
		if (!periodResult.valid) {
			return { valid: false, error: periodResult.error };
		}
		period = periodResult.value;
	}

	const comparisonResult = validateComparisonSpec(raw.comparison);
	if (!comparisonResult.valid) {
		return { valid: false, error: comparisonResult.error };
	}

	const activityRefResult = validateActivityReference(raw.activityReference);
	if (!activityRefResult.valid) {
		return { valid: false, error: activityRefResult.error };
	}

	const parameters = {};
	if (raw.parameters && typeof raw.parameters === 'object' && !Array.isArray(raw.parameters)) {
		for (const [key, value] of Object.entries(raw.parameters)) {
			if (FORBIDDEN_GOAL_KEYS.includes(key)) {
				return { valid: false, error: 'FORBIDDEN_PARAMETER' };
			}
			if (typeof value === 'string' && UUID_PATTERN.test(value) && key.toLowerCase().includes('activity')) {
				return { valid: false, error: 'ACTIVITY_UUID_NOT_ALLOWED' };
			}
			parameters[key] = value;
		}
	}

	if (type === 'ACTION' && objective === 'CREATE' && options.rejectWriteExecution) {
		// Classifier output is intent-only — never treated as executed write.
		parameters._classifierOnly = true;
	}

	return {
		valid: true,
		value: {
			type,
			domain,
			objective,
			period,
			comparison: comparisonResult.value,
			activityReference: activityRefResult.value,
			parameters,
		},
	};
}

export function normalizeGoal(raw, options = {}) {
	const referenceDate = options.referenceDate || new Date();

	if (raw?.period && typeof raw.period === 'string') {
		const period = normalizePeriodSpec(raw.period, referenceDate);
		if (period) {
			return validateGoal({ ...raw, period }, options);
		}
	}

	return validateGoal(raw, options);
}

/** Goal objects never contain financial truth — only intent metadata. */
export function assertGoalIsNotFinancialTruth(goal) {
	if (!goal) return true;

	const forbiddenFinancialKeys = [
		'revenue', 'totalRevenue', 'totalCollected',
		'totalExpenses', 'estimatedProfit', 'balance',
	];
	const parameters = goal.parameters || {};
	for (const key of forbiddenFinancialKeys) {
		if (parameters[key] != null) {
			return false;
		}
	}

	if (parameters.amount != null && goal.objective !== 'CREATE') {
		return false;
	}

	return true;
}
