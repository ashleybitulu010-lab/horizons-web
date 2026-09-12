import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildActivitySummary,
	generateActivityReport,
	resetComposeReportImplForTests,
	setComposeReportImplForTests,
} from '../src/services/report-service.js';
import {
	resetDebtsQueryImplForTests,
	setDebtsQueryImplForTests,
} from '../src/services/debts-service.js';
import {
	resetExpensesQueryImplForTests,
	setExpensesQueryImplForTests,
} from '../src/services/expenses-service.js';
import {
	resetSalesQueryImplForTests,
	setSalesQueryImplForTests,
} from '../src/services/sales-service.js';
import {
	resetStockQueryImplForTests,
	setStockQueryImplForTests,
} from '../src/services/stock-service.js';
import {
	runGenerateReport,
	validateGenerateReportInput,
} from '../src/tools/generate-report.js';
import { assertToolResultShape } from '../src/utils/tool-result.js';

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

const REFERENCE_DATE = new Date('2026-08-15T12:00:00.000Z');

const SALES_A = [{
	id: '1',
	client_id: 'client_a',
	libelle: 'Poulet',
	quantite: 2,
	prix_unitaire: 10,
	montant_paye: 15,
	total_brut: 20,
	reste_a_payer: 5,
	date: '2026-08-10T10:00:00.000Z',
	statut: 'Partiel',
}];

const EXPENSES_A = [{
	id: '10',
	client_id: 'client_a',
	libelle_depense: 'Transport',
	type_depense: 'Transport',
	montant_depense: 7,
	date: '2026-08-10T10:00:00.000Z',
}];

const DEBTS_A = [{
	id: '1',
	client_id: 'client_a',
	libelle: 'Client Alpha',
	montant_paye: 15,
	total_brut: 20,
	reste_a_payer: 5,
	date: '2026-08-10T10:00:00.000Z',
	statut: 'Partiel',
}];

const STOCKS_A = [{
	numero: 1,
	client_id: 'client_a',
	produit_id: 'prod-1',
	nom_article: 'Savon',
	stock_actuel: 0,
	seuil_alerte: 5,
}, {
	numero: 2,
	client_id: 'client_a',
	produit_id: 'prod-2',
	nom_article: 'Cahiers',
	stock_actuel: 12,
	seuil_alerte: 5,
}];

test('buildActivitySummary computes profit from collected minus expenses', () => {
	const result = buildActivitySummary(
		{
			count: 1,
			totalRevenue: 20,
			totalCollected: 15,
			totalOutstanding: 5,
			totalQuantity: 2,
			byProduct: [],
		},
		{
			count: 1,
			totalAmount: 7,
			byCategory: [],
		},
		{
			count: 1,
			unpaidCount: 1,
			totalRemaining: 5,
			debtorCount: 1,
			byDebtor: [],
		},
		{
			count: 2,
			totalQuantity: 12,
			lowStockCount: 1,
			outOfStockCount: 1,
			items: [],
		},
	);

	assert.equal(result.summary.estimatedProfit, 8);
	assert.equal(result.summary.reportType, 'activity_summary');
	assert.equal(result.sections.debts.totalRemaining, 5);
	assert.equal(result.sections.stock.lowStockCount, 1);
});

test.beforeEach(() => {
	setSalesQueryImplForTests(async (scope, _range, input) => {
		if (scope.clientId === 'client_a' && input.period === 'current_month') return SALES_A;
		if (scope.clientId === 'client_b') return [];
		return [];
	});
	setExpensesQueryImplForTests(async (scope, _range, input) => {
		if (scope.clientId === 'client_a' && input.period === 'current_month') return EXPENSES_A;
		if (scope.clientId === 'client_b') return [];
		return [];
	});
	setDebtsQueryImplForTests(async (scope) => {
		if (scope.clientId === 'client_a') return DEBTS_A;
		if (scope.clientId === 'client_b') return [];
		return [];
	});
	setStockQueryImplForTests(async (scope) => {
		if (scope.clientId === 'client_a') return { stocks: STOCKS_A, products: [] };
		if (scope.clientId === 'client_b') return { stocks: [], products: [] };
		return { stocks: [], products: [] };
	});
});

test.afterEach(() => {
	resetSalesQueryImplForTests();
	resetExpensesQueryImplForTests();
	resetDebtsQueryImplForTests();
	resetStockQueryImplForTests();
	resetComposeReportImplForTests();
});

test('generateActivityReport defaults to current_month and scopes by client', async () => {
	const result = await generateActivityReport(USER_A, {}, REFERENCE_DATE);
	assert.equal(result.input.period, 'current_month');
	assert.equal(result.summary.totalCollected, 15);
	assert.equal(result.summary.totalExpenses, 7);
	assert.equal(result.summary.estimatedProfit, 8);
	assert.equal(result.summary.unpaidDebtTotal, 5);
});

test('generateActivityReport returns empty metrics for isolated client B', async () => {
	const result = await generateActivityReport(USER_B, { period: 'current_month' }, REFERENCE_DATE);
	assert.equal(result.summary.salesCount, 0);
	assert.equal(result.summary.totalExpenses, 0);
	assert.equal(result.summary.estimatedProfit, 0);
});

test('validateGenerateReportInput rejects identity params', () => {
	assert.throws(
		() => validateGenerateReportInput({ clientId: 'other' }),
		/Forbidden parameter for generate_report: clientId/,
	);
});

test('runGenerateReport returns structured ToolResult', async () => {
	const result = await runGenerateReport({ user: USER_A }, { period: 'current_month' }, REFERENCE_DATE);
	assertToolResultShape(result);
	assert.equal(result.tool, 'generate_report');
	assert.equal(result.success, true);
	assert.equal(result.data.summary.reportType, 'activity_summary');
	assert.equal(result.meta.period, 'current_month');
});

test('runGenerateReport fails fast when sales query fails', async () => {
	setSalesQueryImplForTests(async () => {
		const error = new Error('db down');
		error.code = 'SUPABASE_QUERY_FAILED';
		throw error;
	});

	const result = await runGenerateReport({ user: USER_A }, { period: 'current_month' }, REFERENCE_DATE);
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'SUPABASE_ERROR');
});

test('composeReportImpl override is used in tests', async () => {
	setComposeReportImplForTests(async () => ({
		summary: {
			reportType: 'activity_summary',
			salesCount: 0,
			totalRevenue: 0,
			totalCollected: 0,
			expenseCount: 0,
			totalExpenses: 0,
			estimatedProfit: 0,
			unpaidDebtTotal: 0,
			unpaidDebtCount: 0,
			stockItemCount: 0,
			lowStockCount: 0,
			outOfStockCount: 0,
		},
		sections: {
			sales: { count: 0, totalRevenue: 0, totalCollected: 0 },
			expenses: { count: 0, totalAmount: 0 },
			debts: { unpaidCount: 0, totalRemaining: 0 },
			stock: { count: 0, lowStockCount: 0, outOfStockCount: 0 },
		},
		range: {
			period: 'current_month',
			startDate: '2026-08-01',
			endDate: '2026-08-31',
			timeZone: 'Africa/Kinshasa',
		},
		input: { period: 'current_month' },
	}));

	const result = await generateActivityReport(USER_A, { period: 'current_month' }, REFERENCE_DATE);
	assert.equal(result.summary.salesCount, 0);
});
