import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveIntent } from '../src/agent/intent-resolver.js';
import {
	resetIntentResolverTestOverrides,
	setChatCompletionImplForTests,
	setForceLlmResolverForTests,
	setForceRegexResolverForTests,
} from '../src/agent/intent-resolver/index.js';

test.beforeEach(() => {
	resetIntentResolverTestOverrides();
	setForceRegexResolverForTests(true);
});

test.afterEach(() => {
	resetIntentResolverTestOverrides();
});

test('regex resolves bilan text request to generate_report', async () => {
	const resolved = await resolveIntent('Je peux avoir mon bilan');
	assert.equal(resolved.intent, 'generate_report');
	assert.equal(resolved.topic, 'report');
	assert.equal(resolved.filters.period, 'current_month');
	assert.equal(resolved.needsTool, true);
});

test('regex resolves benefit question to generate_report', async () => {
	const resolved = await resolveIntent('Quel est mon bénéfice ?');
	assert.equal(resolved.intent, 'generate_report');
	assert.equal(resolved.topic, 'report');
});

test('regex resolves activity summary with explicit month', async () => {
	const resolved = await resolveIntent('Fais-moi un bilan ce mois-ci');
	assert.equal(resolved.intent, 'generate_report');
	assert.equal(resolved.filters.period, 'current_month');
});

test('regex resolves previous month report period', async () => {
	const resolved = await resolveIntent('Résumé de mon activité du mois dernier');
	assert.equal(resolved.intent, 'generate_report');
	assert.equal(resolved.filters.period, 'previous_month');
});

test('regex keeps sales routing for vendu question', async () => {
	const resolved = await resolveIntent('Combien ai-je vendu ce mois-ci ?');
	assert.equal(resolved.intent, 'query_sales');
	assert.notEqual(resolved.intent, 'generate_report');
});

test('regex keeps expenses routing for depense question', async () => {
	const resolved = await resolveIntent('Combien ai-je dépensé ce mois-ci ?');
	assert.equal(resolved.intent, 'query_expenses');
});

test('regex keeps compare routing for ventes et depenses', async () => {
	const resolved = await resolveIntent('Compare mes ventes et mes dépenses ce mois-ci.');
	assert.equal(resolved.intent, 'compare_sales_expenses');
});

test('regex clarifies PDF report request', async () => {
	const resolved = await resolveIntent('Envoie-moi mon bilan du mois en PDF');
	assert.equal(resolved.needsClarification, true);
	assert.equal(resolved.needsTool, false);
	assert.match(resolved.clarificationQuestion, /PDF/i);
});

test('regex clarifies how-to report question', async () => {
	const resolved = await resolveIntent('Comment générer mon bilan PDF ?');
	assert.equal(resolved.needsClarification, true);
	assert.equal(resolved.needsTool, false);
});

test('regex clarifies ambiguous report period', async () => {
	const resolved = await resolveIntent('Fais-moi un bilan récemment');
	assert.equal(resolved.needsClarification, true);
	assert.match(resolved.clarificationQuestion, /période/i);
});

test('regex inherits report period from conversation context', async () => {
	const resolved = await resolveIntent('Et mon bilan ?', {
		topic: 'report',
		references: { lastPeriod: 'previous_month', lastEntity: 'report' },
	});
	assert.equal(resolved.intent, 'generate_report');
	assert.equal(resolved.filters.period, 'previous_month');
});

test('LLM resolver returns generate_report when mock succeeds', async () => {
	setForceRegexResolverForTests(false);
	setForceLlmResolverForTests(true);
	setChatCompletionImplForTests(async () => JSON.stringify({
		intent: 'generate_report',
		topic: 'report',
		filters: { period: 'current_month' },
		references: {},
		needsTool: true,
		needsClarification: false,
	}));

	const resolved = await resolveIntent('Où en suis-je ce mois-ci ?');
	assert.equal(resolved.resolver, 'llm');
	assert.equal(resolved.intent, 'generate_report');
	assert.equal(resolved.topic, 'report');
});

test('LLM invalid JSON falls back to regex report routing', async () => {
	setForceRegexResolverForTests(false);
	setForceLlmResolverForTests(true);
	setChatCompletionImplForTests(async () => 'not-json');

	const resolved = await resolveIntent('Fais-moi un récapitulatif');
	assert.equal(resolved.resolver, 'regex');
	assert.equal(resolved.intent, 'generate_report');
	assert.equal(resolved.resolverMeta?.fallback, true);
});
