import assert from 'node:assert/strict';
import test from 'node:test';

import { runGetDebts, validateGetDebtsInput } from '../src/tools/get-debts.js';
import { assertToolResultShape } from '../src/utils/tool-result.js';
import {
	setDebtsQueryImplForTests,
	resetDebtsQueryImplForTests,
} from '../src/services/debts-service.js';

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

const DEBTS_A = [
	{
		id: '1',
		client_id: 'client_a',
		libelle: 'Client Kabila',
		montant_paye: 10,
		total_brut: 50,
		reste_a_payer: 40,
		date: '2026-08-10T10:00:00.000Z',
		statut: 'Partiel',
	},
	{
		id: '2',
		client_id: 'client_a',
		libelle: 'Client Mwamba',
		montant_paye: 0,
		total_brut: 25,
		reste_a_payer: 25,
		date: '2026-08-12T10:00:00.000Z',
		statut: 'Impayé',
	},
];

const DEBTS_B = [
	{
		id: '3',
		client_id: 'client_b',
		libelle: 'Client Test',
		montant_paye: 5,
		total_brut: 30,
		reste_a_payer: 25,
		date: '2026-08-10T10:00:00.000Z',
		statut: 'Partiel',
	},
];

const SETTLED_A = [
	{
		id: '4',
		client_id: 'client_a',
		libelle: 'Client Soldé',
		montant_paye: 20,
		total_brut: 20,
		reste_a_payer: 0,
		date: '2026-07-10T10:00:00.000Z',
		statut: 'Payé',
	},
];

test.beforeEach(() => {
	setDebtsQueryImplForTests(async (clientId) => {
		if (clientId === 'client_a') return DEBTS_A;
		if (clientId === 'client_b') return DEBTS_B;
		return [];
	});
});

test.afterEach(() => {
	resetDebtsQueryImplForTests();
});

test('user A gets only debts A', async () => {
	const result = await runGetDebts({ user: USER_A }, { status: 'unpaid' });
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 2);
	assert.equal(result.data.summary.totalRemaining, 65);
	assert.equal(result.error, null);
});

test('user B gets only debts B', async () => {
	const result = await runGetDebts({ user: USER_B }, { status: 'unpaid' });
	assert.equal(result.success, true);
	assert.equal(result.data.summary.totalRemaining, 25);
});

test('forbidden clientId parameter is rejected', async () => {
	const result = await runGetDebts({ user: USER_A }, { clientId: 'client_b' });
	assert.equal(result.success, false);
	assert.equal(result.data, null);
	assert.equal(result.error.code, 'FORBIDDEN_PARAMETER');
});

test('forbidden businessUserId parameter is rejected', async () => {
	const result = await runGetDebts({ user: USER_A }, { businessUserId: 'rec_b' });
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'FORBIDDEN_PARAMETER');
});

test('missing client scope returns structured error', async () => {
	const result = await runGetDebts({ user: { id: 'pb_x' } }, {});
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'CLIENT_SCOPE_MISSING');
});

test('invalid period returns validation error', async () => {
	const result = await runGetDebts({ user: USER_A }, { period: 'not_a_period' });
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'INVALID_PERIOD');
});

test('validateGetDebtsInput rejects userId', () => {
	assert.throws(
		() => validateGetDebtsInput({ userId: 'x' }),
		/Forbidden parameter for get_debts: userId/,
	);
});

test('empty debts returns success with zero count', async () => {
	setDebtsQueryImplForTests(async () => []);
	const result = await runGetDebts({ user: USER_A }, { status: 'unpaid' });
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 0);
	assert.equal(result.data.summary.totalRemaining, 0);
});

test('supabase query failure returns structured error', async () => {
	setDebtsQueryImplForTests(async () => {
		const error = new Error('db down');
		error.code = 'SUPABASE_QUERY_FAILED';
		throw error;
	});
	const result = await runGetDebts({ user: USER_A }, { status: 'unpaid' });
	assert.equal(result.success, false);
	assert.equal(result.data, null);
	assert.equal(result.error.code, 'SUPABASE_ERROR');
	assert.match(result.error.message, /debts|data/i);
});

test('get_debts current_month period meta is returned', async () => {
	const result = await runGetDebts(
		{ user: USER_A },
		{ period: 'current_month', status: 'unpaid' },
		new Date('2026-08-15T12:00:00.000Z'),
	);
	assert.equal(result.meta.period, 'current_month');
	assert.equal(result.meta.status, 'unpaid');
});

test('get_debts settled status filters settled rows', async () => {
	setDebtsQueryImplForTests(async (clientId) => (
		clientId === 'client_a' ? [...DEBTS_A, ...SETTLED_A] : []
	));
	const result = await runGetDebts({ user: USER_A }, { status: 'settled' });
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 1);
	assert.equal(result.data.debts[0].remaining, 0);
});

test('get_debts unpaid status excludes settled rows', async () => {
	setDebtsQueryImplForTests(async (clientId) => (
		clientId === 'client_a' ? [...DEBTS_A, ...SETTLED_A] : []
	));
	const result = await runGetDebts({ user: USER_A }, { status: 'unpaid' });
	assert.equal(result.success, true);
	assert.equal(result.data.summary.unpaidCount, 2);
	assert.equal(result.data.summary.totalRemaining, 65);
});

test('ToolResult shape is normalized', async () => {
	const result = assertToolResultShape(await runGetDebts({ user: USER_A }, { status: 'unpaid' }));
	assert.equal(result.tool, 'get_debts');
});

test('unauthenticated context is rejected', async () => {
	const result = await runGetDebts({ user: null }, { status: 'unpaid' });
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'UNAUTHENTICATED');
});
