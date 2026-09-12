import assert from 'node:assert/strict';
import test from 'node:test';

import { runGetSales, validateGetSalesInput } from '../src/tools/get-sales.js';
import { setSalesQueryImplForTests, resetSalesQueryImplForTests } from '../src/services/sales-service.js';

const USER_A = {
	id: 'pb_a',
	clientId: 'client_a',
	activeActivityId: 'activity_a',
	businessUserId: 'rec_a',
};

const USER_B = {
	id: 'pb_b',
	clientId: 'client_b',
	activeActivityId: 'activity_b',
	businessUserId: 'rec_b',
};

const SALES_A = [
	{
		id: '1',
		client_id: 'client_a',
		libelle: 'Poulet',
		quantite: 2,
		prix_unitaire: 10,
		montant_paye: 20,
		total_brut: 20,
		reste_a_payer: 0,
		date: '2026-08-10T10:00:00.000Z',
		statut: 'Payé',
	},
];

const SALES_B = [
	{
		id: '2',
		client_id: 'client_b',
		libelle: 'Poisson',
		quantite: 1,
		prix_unitaire: 15,
		montant_paye: 15,
		total_brut: 15,
		reste_a_payer: 0,
		date: '2026-08-10T10:00:00.000Z',
		statut: 'Payé',
	},
];

test.beforeEach(() => {
	setSalesQueryImplForTests(async (scope) => {
		if (scope.clientId === 'client_a') return SALES_A;
		if (scope.clientId === 'client_b') return SALES_B;
		return [];
	});
});

test.afterEach(() => {
	resetSalesQueryImplForTests();
});

test('user A gets only sales A', async () => {
	const result = await runGetSales({ user: USER_A }, { period: 'current_month' }, new Date('2026-08-15T12:00:00.000Z'));
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 1);
	assert.equal(result.data.summary.totalRevenue, 20);
});

test('user B gets only sales B', async () => {
	const result = await runGetSales({ user: USER_B }, { period: 'current_month' }, new Date('2026-08-15T12:00:00.000Z'));
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 1);
	assert.equal(result.data.summary.totalRevenue, 15);
});

test('forbidden clientId parameter is rejected', async () => {
	const result = await runGetSales({ user: USER_A }, { period: 'current_month', clientId: 'client_b' });
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'FORBIDDEN_PARAMETER');
});

test('missing client scope returns structured error', async () => {
	const result = await runGetSales({ user: { id: 'pb_x' } }, { period: 'current_month' });
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'CLIENT_SCOPE_MISSING');
});

test('invalid period returns validation error', async () => {
	const result = await runGetSales({ user: USER_A }, { period: 'not_a_period' });
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'INVALID_PERIOD');
});

test('forbidden businessUserId parameter is rejected', async () => {
	const result = await runGetSales({ user: USER_A }, { period: 'current_month', businessUserId: 'rec_b' });
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'FORBIDDEN_PARAMETER');
});

test('validateGetSalesInput rejects userId', () => {
	assert.throws(
		() => validateGetSalesInput({ userId: 'x' }),
		/Forbidden parameter for get_sales: userId/,
	);
});

test('error result never exposes data payload', async () => {
	setSalesQueryImplForTests(async () => {
		const error = new Error('db down');
		error.code = 'SUPABASE_QUERY_FAILED';
		throw error;
	});
	const result = await runGetSales({ user: USER_A }, { period: 'current_month' });
	assert.equal(result.success, false);
	assert.equal(result.data, null);
});

test('empty sales returns success with zero count', async () => {
	setSalesQueryImplForTests(async () => []);
	const result = await runGetSales({ user: USER_A }, { period: 'current_month' }, new Date('2026-08-15T12:00:00.000Z'));
	assert.equal(result.success, true);
	assert.equal(result.data.summary.count, 0);
});

test('supabase query failure returns structured error', async () => {
	setSalesQueryImplForTests(async () => {
		const error = new Error('db down');
		error.code = 'SUPABASE_QUERY_FAILED';
		throw error;
	});
	const result = await runGetSales({ user: USER_A }, { period: 'current_month' });
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'SUPABASE_ERROR');
});
