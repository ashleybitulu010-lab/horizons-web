import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildDebtQueryFilters,
	extractDebtorFromText,
	resolveDebtStatusFromText,
} from '../src/agent/intent-resolver/debt-resolver-helpers.js';
import { resolveIntent } from '../src/agent/intent-resolver.js';

test('resolveDebtStatusFromText detects explicit unpaid', () => {
	const result = resolveDebtStatusFromText('Montre-moi mes dettes impayées');
	assert.equal(result.status, 'unpaid');
	assert.equal(result.explicit, true);
});

test('resolveDebtStatusFromText detects explicit settled', () => {
	const result = resolveDebtStatusFromText('Quelles dettes sont réglées ?');
	assert.equal(result.status, 'settled');
	assert.equal(result.explicit, true);
});

test('resolveDebtStatusFromText detects explicit all', () => {
	const result = resolveDebtStatusFromText('Montre-moi toutes mes dettes');
	assert.equal(result.status, 'all');
	assert.equal(result.explicit, true);
});

test('resolveDebtStatusFromText defaults generic query to unpaid', () => {
	const result = resolveDebtStatusFromText('Quelles sont mes dettes ?');
	assert.equal(result.status, 'unpaid');
	assert.equal(result.defaultGeneric, true);
});

test('resolveDebtStatusFromText inherits status from debts conversation', () => {
	const result = resolveDebtStatusFromText('Et mes dettes ?', {
		topic: 'debts',
		filters: { status: 'settled' },
	});
	assert.equal(result.status, 'settled');
	assert.equal(result.inherited, true);
});

test('resolveDebtStatusFromText flags ambiguous conflicting status', () => {
	const result = resolveDebtStatusFromText('Dettes impayées et réglées');
	assert.equal(result.status, null);
	assert.equal(result.ambiguous, true);
});

test('extractDebtorFromText parses named debtor', () => {
	assert.equal(extractDebtorFromText('Combien me doit Jean ?'), 'Jean');
	assert.equal(extractDebtorFromText('Et celles de Kabila ?'), 'Kabila');
});

test('buildDebtQueryFilters combines status and debtor', () => {
	const built = buildDebtQueryFilters('Combien me doit Mwamba ?');
	assert.equal(built.filters.status, 'unpaid');
	assert.equal(built.filters.debtor, 'Mwamba');
	assert.equal(built.needsClarification, false);
});

test('regex resolves unpaid debts explicitly', async () => {
	const resolved = await resolveIntent('Montre-moi mes dettes impayées');
	assert.equal(resolved.intent, 'query_debts');
	assert.equal(resolved.filters.status, 'unpaid');
});

test('regex resolves settled debts explicitly', async () => {
	const resolved = await resolveIntent('Quelles dettes sont réglées ?');
	assert.equal(resolved.intent, 'query_debts');
	assert.equal(resolved.filters.status, 'settled');
});

test('regex resolves all debts explicitly', async () => {
	const resolved = await resolveIntent('Montre-moi toutes mes dettes');
	assert.equal(resolved.intent, 'query_debts');
	assert.equal(resolved.filters.status, 'all');
});

test('regex resolves who owes money query', async () => {
	const resolved = await resolveIntent('Qui me doit de l\'argent ?');
	assert.equal(resolved.intent, 'query_debts');
	assert.equal(resolved.filters.status, 'unpaid');
});

test('regex follow-up settled after debts topic', async () => {
	const resolved = await resolveIntent('Et les dettes réglées ?', {
		topic: 'debts',
		references: { lastEntity: 'debts' },
	});
	assert.equal(resolved.intent, 'query_debts');
	assert.equal(resolved.filters.status, 'settled');
});

test('regex follow-up debtor after debts topic', async () => {
	const resolved = await resolveIntent('Et celles de Jean ?', {
		topic: 'debts',
		filters: { status: 'unpaid' },
		references: { lastEntity: 'debts' },
	});
	assert.equal(resolved.intent, 'query_debts');
	assert.equal(resolved.filters.debtor, 'Jean');
	assert.equal(resolved.filters.status, 'unpaid');
});

test('regex ambiguous debt status requests clarification', async () => {
	const resolved = await resolveIntent('Dettes impayées et réglées en même temps');
	assert.equal(resolved.needsClarification, true);
	assert.equal(resolved.needsTool, false);
	assert.match(resolved.clarificationQuestion, /impay|r[eé]gl|toutes/i);
});

test('regex debts with period filter', async () => {
	const resolved = await resolveIntent('Quelles sont mes dettes impayées ce mois-ci ?');
	assert.equal(resolved.intent, 'query_debts');
	assert.equal(resolved.filters.status, 'unpaid');
	assert.equal(resolved.filters.period, 'current_month');
});
