import { PERIOD_IDS } from '../../utils/periods.js';
import { primaryToolForIntent } from '../tool-planner.js';

export const ALLOWED_INTENTS = Object.freeze([
	'query_sales',
	'query_expenses',
	'query_stock',
	'compare_sales',
	'compare_expenses',
	'compare_sales_expenses',
	'best_product',
	'unknown',
]);

export const ALLOWED_TOPICS = Object.freeze([
	'sales',
	'expenses',
	'stock',
	'mixed',
	null,
]);

export const ALLOWED_FILTER_KEYS = Object.freeze([
	'period',
	'periods',
	'product',
	'category',
	'lowStockOnly',
]);

export const FORBIDDEN_LLM_KEYS = Object.freeze([
	'userId',
	'clientId',
	'client_id',
	'user_id',
	'businessUserId',
	'tenantId',
	'tenant_id',
	'sql',
	'query',
	'tool',
	'execute',
	'supabase',
]);

const SQL_INJECTION_PATTERN = /\b(select|insert|update|delete|drop|truncate|alter)\b.*\b(from|into|table)\b/i;

export function createEmptyResolved(conversationState = {}) {
	return {
		intent: 'unknown',
		topic: conversationState.topic || null,
		filters: { ...(conversationState.filters || {}) },
		references: { ...(conversationState.references || {}) },
		needsTool: false,
		needsClarification: false,
		clarificationQuestion: null,
		resolver: 'regex',
		resolverMeta: null,
	};
}

export function inheritPeriodFromContext(conversationState = {}) {
	return conversationState.references?.lastPeriod
		|| conversationState.filters?.period
		|| 'current_month';
}

export function applyContextInheritance(resolved, conversationState = {}) {
	const filters = { ...(resolved.filters || {}) };

	if (
		(resolved.intent === 'query_sales' || resolved.intent === 'query_expenses')
		&& !filters.period
		&& !filters.periods
	) {
		filters.period = inheritPeriodFromContext(conversationState);
	}

	if (resolved.intent === 'compare_sales_expenses' && !filters.period) {
		filters.period = inheritPeriodFromContext(conversationState);
	}

	return {
		...resolved,
		filters,
	};
}

export function validateAndNormalizeResolvedIntent(raw, conversationState = {}) {
	if (!raw || typeof raw !== 'object') {
		return null;
	}

	const serialized = JSON.stringify(raw);
	if (SQL_INJECTION_PATTERN.test(serialized)) {
		return null;
	}

	for (const key of FORBIDDEN_LLM_KEYS) {
		if (raw[key] != null) return null;
		if (raw.filters?.[key] != null) return null;
		if (raw.references?.[key] != null) return null;
	}

	const intent = String(raw.intent || 'unknown');
	if (!ALLOWED_INTENTS.includes(intent)) {
		return null;
	}

	const topic = raw.topic == null ? null : String(raw.topic);
	if (!ALLOWED_TOPICS.includes(topic)) {
		return null;
	}

	const needsClarification = Boolean(raw.needsClarification);
	const needsTool = needsClarification ? false : Boolean(raw.needsTool);

	const filters = {};
	if (raw.filters && typeof raw.filters === 'object') {
		for (const key of Object.keys(raw.filters)) {
			if (!ALLOWED_FILTER_KEYS.includes(key)) return null;
			filters[key] = raw.filters[key];
		}
	}

	if (filters.period && !PERIOD_IDS.includes(filters.period)) {
		return null;
	}
	if (filters.periods) {
		if (!Array.isArray(filters.periods) || filters.periods.some((p) => !PERIOD_IDS.includes(p))) {
			return null;
		}
	}
	if (filters.lowStockOnly != null && typeof filters.lowStockOnly !== 'boolean') {
		return null;
	}
	if (filters.product != null && typeof filters.product !== 'string') return null;
	if (filters.category != null && typeof filters.category !== 'string') return null;

	const references = {};
	if (raw.references && typeof raw.references === 'object') {
		for (const [key, value] of Object.entries(raw.references)) {
			if (typeof value !== 'string' && value != null) return null;
			references[key] = value;
		}
	}

	const normalized = applyContextInheritance({
		intent,
		topic,
		filters,
		references,
		needsTool,
		needsClarification,
		clarificationQuestion: needsClarification
			? String(raw.clarificationQuestion || 'Peux-tu préciser ta demande ?')
			: null,
	}, conversationState);

	if (needsClarification) {
		normalized.intent = 'unknown';
		normalized.needsTool = false;
	}

	return normalized;
}

export function conversationPatchFromIntent(resolved) {
	return {
		topic: resolved.topic,
		intent: resolved.intent,
		filters: resolved.filters || {},
		references: resolved.references || {},
		lastTool: resolved.needsTool ? primaryToolForIntent(resolved.intent) : null,
		lastAction: resolved.intent,
	};
}
