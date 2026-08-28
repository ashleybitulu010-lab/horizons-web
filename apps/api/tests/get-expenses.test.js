import assert from 'node:assert/strict';
import test from 'node:test';

import { runGetExpenses, validateGetExpensesInput } from '../src/tools/get-expenses.js';
import { assertToolResultShape } from '../src/utils/tool-result.js';
import {
	setExpensesQueryImplForTests,
	resetExpensesQueryImplForTests,
} from '../src/services/expenses-service.js';

const USER_A = {
	id: 'pb_a',
	clientId: 'client_a',
	businessUserId: 'rec_a',
};

const USER_B = {
	id: 'pb_b',
	clientId: 'client_b',
	businessUserId: 'rec_b',
};

const EXPENSES_A = [
	{
		id: '1',
		client_id: 'client_a',
		libelle_depense: 'Transport',
		type_depense: 'Transport',
		montant_depense: 20,
		date: '2026-08-10T10:00:00.000Z',
	},
];

const EXPENSES_B = [
	{
		id: '2',
		client_id: 'client_b',
		libelle_depense: 'Loyer',
		type_depense: 'Loyer',
		montant_depense: 150,
		date: '2026-08-10T10:00:00.000Z',
	},
];

test.beforeEach(() => {
	setExpensesQueryImplForTests(async (clientId) => {
		if (clientId === 'client_a') return EXPENSES_A;
		if (clientId === 'client_b') return EXPENSES_B;
		return [];
	});
});

test.afterEach(() => {
	resetExpensesQueryImplForTests();
});

test('user A gets only expenses A', async () => {
	const result = await runGetExpenses(
		{ user: USER_A },
		{ period: 'current_month' },
		new Date('2026-08-15T12:00:00.000Z'),
	);
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 1);
	assert.equal(result.data.summary.totalAmount, 20);
	assert.equal(result.error, null);
});

test('user B gets only expenses B', async () => {
	const result = await runGetExpenses(
		{ user: USER_B },
		{ period: 'current_month' },
		new Date('2026-08-15T12:00:00.000Z'),
	);
	assert.equal(result.success, true);
	assert.equal(result.data.summary.totalAmount, 150);
});

test('forbidden clientId parameter is rejected', async () => {
	const result = await runGetExpenses({ user: USER_A }, { period: 'current_month', clientId: 'client_b' });
	assert.equal(result.success, false);
	assert.equal(result.data, null);
	assert.equal(result.error.code, 'FORBIDDEN_PARAMETER');
});

test('forbidden businessUserId parameter is rejected', async () => {
	const result = await runGetExpenses({ user: USER_A }, { period: 'current_month', businessUserId: 'rec_b' });
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'FORBIDDEN_PARAMETER');
});

test('missing client scope returns structured error', async () => {
	const result = await runGetExpenses({ user: { id: 'pb_x' } }, { period: 'current_month' });
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'CLIENT_SCOPE_MISSING');
});

test('invalid period returns validation error', async () => {
	const result = await runGetExpenses({ user: USER_A }, { period: 'not_a_period' });
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'INVALID_PERIOD');
});

test('validateGetExpensesInput rejects userId', () => {
	assert.throws(
		() => validateGetExpensesInput({ userId: 'x' }),
		/Forbidden parameter for get_expenses: userId/,
	);
});

test('empty expenses returns success with zero count', async () => {
	setExpensesQueryImplForTests(async () => []);
	const result = await runGetExpenses(
		{ user: USER_A },
		{ period: 'current_month' },
		new Date('2026-08-15T12:00:00.000Z'),
	);
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 0);
	assert.equal(result.data.summary.totalAmount, 0);
});

test('supabase query failure returns structured error', async () => {
	setExpensesQueryImplForTests(async () => {
		const error = new Error('db down');
		error.code = 'SUPABASE_QUERY_FAILED';
		throw error;
	});
	const result = await runGetExpenses({ user: USER_A }, { period: 'current_month' });
	assert.equal(result.success, false);
	assert.equal(result.data, null);
	assert.equal(result.error.code, 'SUPABASE_ERROR');
	assert.match(result.error.message, /expenses/i);
});

test('get_expenses current_month period meta is returned', async () => {
	const result = await runGetExpenses(
		{ user: USER_A },
		{ period: 'current_month' },
		new Date('2026-08-15T12:00:00.000Z'),
	);
	assert.equal(result.meta.period, 'current_month');
});

test('get_expenses previous_month uses period filter', async () => {
	setExpensesQueryImplForTests(async (_clientId, _range, input) => (
		input.period === 'previous_month'
			? [{ ...EXPENSES_A[0], montant_depense: 12, date: '2026-07-10T10:00:00.000Z' }]
			: []
	));
	const result = await runGetExpenses(
		{ user: USER_A },
		{ period: 'previous_month' },
		new Date('2026-08-15T12:00:00.000Z'),
	);
	assert.equal(result.success, true);
	assert.equal(result.meta.period, 'previous_month');
	assert.equal(result.data.summary.totalAmount, 12);
});

test('ToolResult shape is normalized', async () => {
	const result = assertToolResultShape(await runGetExpenses(
		{ user: USER_A },
		{ period: 'current_month' },
		new Date('2026-08-15T12:00:00.000Z'),
	));
	assert.equal(result.tool, 'get_expenses');
});
