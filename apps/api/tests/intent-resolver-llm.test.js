import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveIntent,
	setChatCompletionImplForTests,
	setForceLlmResolverForTests,
	setForceRegexResolverForTests,
	resetIntentResolverTestOverrides,
	validateAndNormalizeResolvedIntent,
} from '../src/agent/intent-resolver/index.js';

test.beforeEach(() => {
	resetIntentResolverTestOverrides();
	setForceRegexResolverForTests(true);
});

test.afterEach(() => {
	resetIntentResolverTestOverrides();
});

test('validateAndNormalizeResolvedIntent rejects identity fields', () => {
	assert.equal(validateAndNormalizeResolvedIntent({
		intent: 'query_expenses',
		topic: 'expenses',
		filters: { clientId: 'other-user' },
		needsTool: true,
	}), null);
});

test('validateAndNormalizeResolvedIntent rejects SQL-like payload', () => {
	assert.equal(validateAndNormalizeResolvedIntent({
		intent: 'unknown',
		topic: null,
		filters: { period: 'SELECT * FROM expenses' },
		needsTool: false,
	}), null);
});

test('validateAndNormalizeResolvedIntent rejects unauthorized intent', () => {
	assert.equal(validateAndNormalizeResolvedIntent({
		intent: 'execute_sql',
		topic: 'expenses',
		needsTool: true,
	}), null);
});

test('validateAndNormalizeResolvedIntent inherits period from context', () => {
	const normalized = validateAndNormalizeResolvedIntent({
		intent: 'query_sales',
		topic: 'sales',
		filters: {},
		needsTool: true,
	}, {
		references: { lastPeriod: 'current_month' },
	});
	assert.equal(normalized.filters.period, 'current_month');
});

test('LLM resolver returns validated intent when mock succeeds', async () => {
	setForceRegexResolverForTests(false);
	setForceLlmResolverForTests(true);
	setChatCompletionImplForTests(async () => JSON.stringify({
		intent: 'query_expenses',
		topic: 'expenses',
		filters: { period: 'current_month' },
		references: {},
		needsTool: true,
		needsClarification: false,
	}));

	const resolved = await resolveIntent('Combien ai-je dépensé ce mois-ci ?');
	assert.equal(resolved.resolver, 'llm');
	assert.equal(resolved.intent, 'query_expenses');
	assert.equal(resolved.needsTool, true);
});

test('LLM invalid JSON falls back to regex', async () => {
	setForceRegexResolverForTests(false);
	setForceLlmResolverForTests(true);
	setChatCompletionImplForTests(async () => 'not-json');

	const resolved = await resolveIntent('Combien ai-je vendu ce mois-ci ?');
	assert.equal(resolved.resolver, 'regex');
	assert.equal(resolved.resolverMeta.fallback, true);
	assert.equal(resolved.intent, 'query_sales');
});

test('LLM timeout falls back to regex', async () => {
	setForceRegexResolverForTests(false);
	setForceLlmResolverForTests(true);
	setChatCompletionImplForTests(async () => {
		const error = new Error('LLM timeout');
		error.code = 'LLM_TIMEOUT';
		throw error;
	});

	const resolved = await resolveIntent('Quel est mon stock ?');
	assert.equal(resolved.resolver, 'regex');
	assert.equal(resolved.resolverMeta.reason, 'LLM_TIMEOUT');
	assert.equal(resolved.intent, 'query_stock');
});

test('LLM clarification request is preserved', async () => {
	setForceRegexResolverForTests(false);
	setForceLlmResolverForTests(true);
	setChatCompletionImplForTests(async () => JSON.stringify({
		intent: 'unknown',
		topic: null,
		filters: {},
		references: {},
		needsTool: false,
		needsClarification: true,
		clarificationQuestion: 'Parles-tu de ventes ou de dépenses ?',
	}));

	const resolved = await resolveIntent('Compare ça');
	assert.equal(resolved.needsClarification, true);
	assert.equal(resolved.needsTool, false);
	assert.match(resolved.clarificationQuestion, /ventes|dépenses/i);
});

test('LLM follow-up sales after expenses context', async () => {
	setForceRegexResolverForTests(false);
	setForceLlmResolverForTests(true);
	setChatCompletionImplForTests(async () => JSON.stringify({
		intent: 'query_sales',
		topic: 'sales',
		filters: {},
		references: {},
		needsTool: true,
		needsClarification: false,
	}));

	const resolved = await resolveIntent('Et les ventes ?', {
		topic: 'expenses',
		references: { lastPeriod: 'current_month' },
	});
	assert.equal(resolved.intent, 'query_sales');
	assert.equal(resolved.filters.period, 'current_month');
});

test('LLM multi-tool compare sales and expenses', async () => {
	setForceRegexResolverForTests(false);
	setForceLlmResolverForTests(true);
	setChatCompletionImplForTests(async () => JSON.stringify({
		intent: 'compare_sales_expenses',
		topic: 'mixed',
		filters: { period: 'current_month' },
		references: {},
		needsTool: true,
		needsClarification: false,
	}));

	const resolved = await resolveIntent('Compare mes ventes et mes dépenses ce mois-ci.');
	assert.equal(resolved.intent, 'compare_sales_expenses');
	assert.equal(resolved.filters.period, 'current_month');
});

test('regex fallback handles follow-up sales after expenses', async () => {
	const resolved = await resolveIntent('Et mes ventes ?', {
		topic: 'expenses',
		references: { lastPeriod: 'current_month' },
	});
	assert.equal(resolved.resolver, 'regex');
	assert.equal(resolved.intent, 'query_sales');
	assert.equal(resolved.filters.period, 'current_month');
});

test('regex fallback handles multi compare sales and expenses', async () => {
	const resolved = await resolveIntent('Compare mes ventes et mes dépenses ce mois-ci.');
	assert.equal(resolved.intent, 'compare_sales_expenses');
	assert.equal(resolved.needsTool, true);
});

test('LLM resolver returns query_debts when mock succeeds', async () => {
	setForceRegexResolverForTests(false);
	setForceLlmResolverForTests(true);
	setChatCompletionImplForTests(async () => JSON.stringify({
		intent: 'query_debts',
		topic: 'debts',
		filters: { status: 'unpaid' },
		references: {},
		needsTool: true,
		needsClarification: false,
	}));

	const resolved = await resolveIntent('Quelles sont mes dettes ?');
	assert.equal(resolved.resolver, 'llm');
	assert.equal(resolved.intent, 'query_debts');
	assert.equal(resolved.topic, 'debts');
});

test('validateAndNormalizeResolvedIntent accepts debts topic and status filter', () => {
	const normalized = validateAndNormalizeResolvedIntent({
		intent: 'query_debts',
		topic: 'debts',
		filters: { status: 'unpaid' },
		needsTool: true,
	});
	assert.equal(normalized.intent, 'query_debts');
	assert.equal(normalized.filters.status, 'unpaid');
});
