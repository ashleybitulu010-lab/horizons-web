/** Ashy Intelligence 2.0 — normalized goal vocabulary. */

export const GOAL_TYPES = Object.freeze([
	'QUESTION',
	'ANALYSIS',
	'ACTION',
	'MIXED',
]);

export const GOAL_DOMAINS = Object.freeze([
	'SALES',
	'EXPENSES',
	'STOCK',
	'PRODUCTS',
	'DEBTS',
	'PROFIT',
	'GENERAL',
]);

export const GOAL_OBJECTIVES = Object.freeze([
	'RETRIEVE',
	'COMPARE',
	'EXPLAIN',
	'CALCULATE',
	'CREATE',
	'UPDATE',
	'ADJUST',
	'SUMMARIZE',
]);

export const PERIOD_SPEC_TYPES = Object.freeze([
	'CURRENT_DAY',
	'CURRENT_WEEK',
	'CURRENT_MONTH',
	'PREVIOUS_DAY',
	'PREVIOUS_WEEK',
	'PREVIOUS_MONTH',
	'CUSTOM',
]);

export const COMPARISON_METRICS = Object.freeze([
	'REVENUE',
	'EXPENSES',
	'PROFIT',
	'SALES_COUNT',
	'STOCK_LEVEL',
	'GENERAL',
]);

export const ANALYSIS_DRIVER_TYPES = Object.freeze([
	'REVENUE_INCREASE',
	'REVENUE_DECREASE',
	'EXPENSE_INCREASE',
	'EXPENSE_DECREASE',
	'PROFIT_INCREASE',
	'PROFIT_DECREASE',
	'DEBT_CHANGE',
	'STOCK_CHANGE',
	'OTHER',
]);

/** Maps legacy period IDs (periods.js) to PeriodSpec.type values. */
export const LEGACY_PERIOD_TO_SPEC_TYPE = Object.freeze({
	today: 'CURRENT_DAY',
	yesterday: 'PREVIOUS_DAY',
	current_week: 'CURRENT_WEEK',
	previous_week: 'PREVIOUS_WEEK',
	current_month: 'CURRENT_MONTH',
	previous_month: 'PREVIOUS_MONTH',
	current_year: 'CURRENT_MONTH',
});

/** Maps PeriodSpec.type back to legacy period IDs where applicable. */
export const SPEC_TYPE_TO_LEGACY_PERIOD = Object.freeze({
	CURRENT_DAY: 'today',
	PREVIOUS_DAY: 'yesterday',
	CURRENT_WEEK: 'current_week',
	PREVIOUS_WEEK: 'previous_week',
	CURRENT_MONTH: 'current_month',
	PREVIOUS_MONTH: 'previous_month',
});

export const FORBIDDEN_GOAL_KEYS = Object.freeze([
	'clientId',
	'client_id',
	'userId',
	'user_id',
	'businessUserId',
	'activityId',
	'activity_id',
	'operationId',
	'operation_id',
	'tenantId',
	'tenant_id',
	'sql',
	'query',
	'tool',
	'execute',
	'supabase',
	'credential',
	'credentials',
	'password',
	'secret',
	'token',
]);

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SQL_INJECTION_PATTERN = /\b(select|insert|update|delete|drop|truncate|alter)\b.*\b(from|into|table)\b/i;
