import assert from 'node:assert/strict';
import test from 'node:test';

import { createAshyAgent } from '../src/agent/index.js';
import {
	clearConversationSessionsForTests,
	clearConversationState,
	getConversationState,
} from '../src/agent/conversation-state.js';
import { setSalesQueryImplForTests, resetSalesQueryImplForTests } from '../src/services/sales-service.js';
import {
	setExpensesQueryImplForTests,
	resetExpensesQueryImplForTests,
} from '../src/services/expenses-service.js';
import {
	setStockQueryImplForTests,
	resetStockQueryImplForTests,
} from '../src/services/stock-service.js';
import {
	setDebtsQueryImplForTests,
	resetDebtsQueryImplForTests,
} from '../src/services/debts-service.js';

const USER = {
	id: 'pb_user',
	clientId: 'client_1',
	businessUserId: 'rec_user',
};

const REFERENCE_DATE = new Date('2026-08-15T12:00:00.000Z');

function salesForPeriod(period) {
	if (period === 'current_month') {
		return [{
			id: '1',
			client_id: 'client_1',
			libelle: 'Poulet',
			quantite: 3,
			prix_unitaire: 10,
			montant_paye: 30,
			total_brut: 30,
			reste_a_payer: 0,
			date: '2026-08-10T10:00:00.000Z',
			statut: 'Payé',
		}];
	}
	if (period === 'previous_month') {
		return [{
			id: '2',
			client_id: 'client_1',
			libelle: 'Poulet',
			quantite: 1,
			prix_unitaire: 10,
			montant_paye: 10,
			total_brut: 10,
			reste_a_payer: 0,
			date: '2026-07-10T10:00:00.000Z',
			statut: 'Payé',
		}];
	}
	return [];
}

function expensesForPeriod(period) {
	if (period === 'current_month') {
		return [{
			id: '10',
			client_id: 'client_1',
			libelle_depense: 'Transport',
			type_depense: 'Transport',
			montant_depense: 25,
			date: '2026-08-10T10:00:00.000Z',
		}];
	}
	if (period === 'previous_month') {
		return [{
			id: '11',
			client_id: 'client_1',
			libelle_depense: 'Loyer',
			type_depense: 'Loyer',
			montant_depense: 15,
			date: '2026-07-10T10:00:00.000Z',
		}];
	}
	return [];
}

function stockRows() {
	return [{
		numero: 1,
		client_id: 'client_1',
		produit_id: 'prod-1',
		nom_article: 'Cahiers',
		stock_actuel: 12,
		seuil_alerte: 5,
	}, {
		numero: 2,
		client_id: 'client_1',
		produit_id: 'prod-2',
		nom_article: 'Stylos',
		stock_actuel: 2,
		seuil_alerte: 5,
	}];
}

function debtsRows() {
	return [{
		id: 'd1',
		client_id: 'client_1',
		libelle: 'Client Alpha',
		montant_paye: 10,
		total_brut: 50,
		reste_a_payer: 40,
		date: '2026-08-10T10:00:00.000Z',
		statut: 'Partiel',
	}];
}

test.beforeEach(() => {
	clearConversationSessionsForTests();
	setSalesQueryImplForTests(async (_clientId, _range, input) => salesForPeriod(input.period));
	setExpensesQueryImplForTests(async (_clientId, _range, input) => expensesForPeriod(input.period));
	setStockQueryImplForTests(async () => ({ stocks: stockRows(), products: [] }));
	setDebtsQueryImplForTests(async () => debtsRows());
});

test.afterEach(() => {
	clearConversationSessionsForTests();
	resetSalesQueryImplForTests();
	resetExpensesQueryImplForTests();
	resetStockQueryImplForTests();
	resetDebtsQueryImplForTests();
});

test('full flow: current month sales question', async () => {
	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Combien ai-je vendu ce mois-ci ?',
		user: USER,
		sessionId: 'sess-1',
		referenceDate: REFERENCE_DATE,
	});

	assert.match(result.reply, /30/);
	assert.equal(result.toolResults.length, 1);
	assert.equal(result.toolResults[0].success, true);
	assert.equal(result.conversation.topic, 'sales');
	assert.equal(result.conversation.references.lastPeriod, 'current_month');
});

test('conversation follow-up: previous month triggers new read', async () => {
	const agent = createAshyAgent();

	await agent.run({
		message: 'Combien ai-je vendu ce mois-ci ?',
		user: USER,
		sessionId: 'sess-2',
		referenceDate: REFERENCE_DATE,
	});

	const second = await agent.run({
		message: 'Et le mois dernier ?',
		user: USER,
		sessionId: 'sess-2',
		referenceDate: REFERENCE_DATE,
	});

	assert.match(second.reply, /10/);
	assert.equal(second.toolResults[0].meta.period, 'previous_month');
});

test('compare uses two fresh tool reads', async () => {
	const agent = createAshyAgent();

	await agent.run({
		message: 'Combien ai-je vendu ce mois-ci ?',
		user: USER,
		sessionId: 'sess-3',
		referenceDate: REFERENCE_DATE,
	});

	await agent.run({
		message: 'Et le mois dernier ?',
		user: USER,
		sessionId: 'sess-3',
		referenceDate: REFERENCE_DATE,
	});

	const compare = await agent.run({
		message: 'Compare les deux.',
		user: USER,
		sessionId: 'sess-3',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(compare.toolResults.length, 2);
	assert.match(compare.reply, /30/);
	assert.match(compare.reply, /10/);
});

test('best product question uses sales summary', async () => {
	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Quel est mon meilleur produit ?',
		user: USER,
		sessionId: 'sess-4',
		referenceDate: REFERENCE_DATE,
	});

	assert.match(result.reply, /Poulet/i);
	assert.equal(result.toolResults.length, 1);
});

test('expenses question switches topic away from sales and reads Supabase', async () => {
	const agent = createAshyAgent();

	await agent.run({
		message: 'Combien ai-je vendu ce mois-ci ?',
		user: USER,
		sessionId: 'sess-exp',
		referenceDate: REFERENCE_DATE,
	});

	const expenses = await agent.run({
		message: 'Combien ai-je dépensé ?',
		user: USER,
		sessionId: 'sess-exp',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(expenses.conversation.topic, 'expenses');
	assert.equal(expenses.toolResults.length, 1);
	assert.equal(expenses.toolResults[0].tool, 'get_expenses');
	assert.match(expenses.reply, /25/);
	assert.doesNotMatch(expenses.reply, /30/);
});

test('expenses current month natural question', async () => {
	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Quel est le total de mes dépenses ce mois-ci ?',
		user: USER,
		sessionId: 'sess-exp-current',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].tool, 'get_expenses');
	assert.match(result.reply, /25/);
});

test('expenses follow-up previous month triggers new read', async () => {
	const agent = createAshyAgent();

	await agent.run({
		message: 'Combien ai-je dépensé ce mois-ci ?',
		user: USER,
		sessionId: 'sess-exp-follow',
		referenceDate: REFERENCE_DATE,
	});

	const second = await agent.run({
		message: 'Et le mois dernier ?',
		user: USER,
		sessionId: 'sess-exp-follow',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(second.toolResults[0].tool, 'get_expenses');
	assert.match(second.reply, /15/);
});

test('expenses compare uses two fresh tool reads', async () => {
	const agent = createAshyAgent();

	await agent.run({
		message: 'Combien ai-je dépensé ce mois-ci ?',
		user: USER,
		sessionId: 'sess-exp-compare',
		referenceDate: REFERENCE_DATE,
	});

	await agent.run({
		message: 'Et le mois dernier ?',
		user: USER,
		sessionId: 'sess-exp-compare',
		referenceDate: REFERENCE_DATE,
	});

	const compare = await agent.run({
		message: 'Compare les deux.',
		user: USER,
		sessionId: 'sess-exp-compare',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(compare.toolResults.length, 2);
	assert.equal(compare.toolResults[0].tool, 'get_expenses');
	assert.match(compare.reply, /25/);
	assert.match(compare.reply, /15/);
});

test('domain switch expenses to sales', async () => {
	const agent = createAshyAgent();

	await agent.run({
		message: 'Combien ai-je dépensé ce mois-ci ?',
		user: USER,
		sessionId: 'sess-switch',
		referenceDate: REFERENCE_DATE,
	});

	const sales = await agent.run({
		message: 'Combien ai-je vendu ?',
		user: USER,
		sessionId: 'sess-switch',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(sales.conversation.topic, 'sales');
	assert.equal(sales.toolResults[0].tool, 'get_sales');
	assert.match(sales.reply, /30/);
});

test('expenses supabase failure never returns success reply', async () => {
	setExpensesQueryImplForTests(async () => {
		const error = new Error('db down');
		error.code = 'SUPABASE_QUERY_FAILED';
		throw error;
	});

	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Combien ai-je dépensé ce mois-ci ?',
		user: USER,
		sessionId: 'sess-exp-err',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].success, false);
	assert.match(result.reply, /expenses/i);
	assert.doesNotMatch(result.reply, /25/);
});

test('empty expenses does not invent totals', async () => {
	setExpensesQueryImplForTests(async () => []);
	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Combien ai-je dépensé ce mois-ci ?',
		user: USER,
		sessionId: 'sess-exp-empty',
		referenceDate: REFERENCE_DATE,
	});

	assert.match(result.reply, /aucune dépense/i);
	assert.equal(result.toolResults[0].summary.count, 0);
});

test('clearing conversation store does not remove Supabase truth', async () => {
	const agent = createAshyAgent();

	await agent.run({
		message: 'Combien ai-je vendu ce mois-ci ?',
		user: USER,
		sessionId: 'sess-clear',
		referenceDate: REFERENCE_DATE,
	});

	clearConversationState(USER.id, 'sess-clear');
	assert.equal(getConversationState(USER.id, 'sess-clear').topic, null);

	const afterClear = await agent.run({
		message: 'Combien ai-je vendu ?',
		user: USER,
		sessionId: 'sess-clear',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(afterClear.toolResults.length, 1);
	assert.match(afterClear.reply, /30/);
});

test('no data does not invent totals', async () => {
	setSalesQueryImplForTests(async () => []);
	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Combien ai-je vendu ce mois-ci ?',
		user: USER,
		sessionId: 'sess-5',
		referenceDate: REFERENCE_DATE,
	});

	assert.match(result.reply, /aucune vente/i);
	assert.equal(result.toolResults[0].summary.count, 0);
});

test('supabase failure never returns success reply', async () => {
	setSalesQueryImplForTests(async () => {
		const error = new Error('db down');
		error.code = 'SUPABASE_QUERY_FAILED';
		throw error;
	});

	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Combien ai-je vendu ce mois-ci ?',
		user: USER,
		sessionId: 'sess-err',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].success, false);
	assert.equal(result.toolResults[0].summary, null);
	assert.match(result.reply, /Unable to retrieve sales data|Supabase|récupérer/i);
	assert.doesNotMatch(result.reply, /30/);
});

test('conversation memory never stores financial totals', async () => {
	const agent = createAshyAgent();
	await agent.run({
		message: 'Combien ai-je vendu ce mois-ci ?',
		user: USER,
		sessionId: 'sess-mem',
		referenceDate: REFERENCE_DATE,
	});

	const stored = getConversationState(USER.id, 'sess-mem');
	assert.equal(stored.filters.totalRevenue, undefined);
	assert.equal(stored.references.totalRevenue, undefined);
	assert.equal(stored.filters.summary, undefined);
	assert.ok(stored.references.lastPeriod);
	assert.ok(Object.keys(stored.references).every((key) => [
		'lastPeriod',
		'previousPeriod',
		'lastProduct',
		'lastEntity',
	].includes(key)));
});

test('stock question executes get_stock from Supabase', async () => {
	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Quel est mon stock ?',
		user: USER,
		sessionId: 'sess-stock-1',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].tool, 'get_stock');
	assert.match(result.reply, /14/);
	assert.equal(result.conversation.topic, 'stock');
});

test('stock product question filters result', async () => {
	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Combien me reste-t-il de cahiers ?',
		user: USER,
		sessionId: 'sess-stock-product',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].tool, 'get_stock');
	assert.match(result.reply, /12/);
	assert.match(result.reply, /Cahiers/i);
});

test('follow-up stock after expenses reads Supabase again', async () => {
	const agent = createAshyAgent();

	await agent.run({
		message: 'Combien ai-je dépensé ce mois-ci ?',
		user: USER,
		sessionId: 'sess-stock-follow',
		referenceDate: REFERENCE_DATE,
	});

	const stock = await agent.run({
		message: 'Et mon stock ?',
		user: USER,
		sessionId: 'sess-stock-follow',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(stock.toolResults[0].tool, 'get_stock');
	assert.match(stock.reply, /14/);
});

test('domain switch stock to sales', async () => {
	const agent = createAshyAgent();

	await agent.run({
		message: 'Quel est mon stock ?',
		user: USER,
		sessionId: 'sess-stock-switch',
		referenceDate: REFERENCE_DATE,
	});

	const sales = await agent.run({
		message: 'Combien ai-je vendu ?',
		user: USER,
		sessionId: 'sess-stock-switch',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(sales.toolResults[0].tool, 'get_sales');
	assert.match(sales.reply, /30/);
});

test('low stock question uses low_stock response', async () => {
	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Quels produits sont presque épuisés ?',
		user: USER,
		sessionId: 'sess-stock-low',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].tool, 'get_stock');
	assert.match(result.reply, /Stylos/i);
});

test('stock supabase failure never returns success reply', async () => {
	setStockQueryImplForTests(async () => {
		const error = new Error('db down');
		error.code = 'SUPABASE_QUERY_FAILED';
		throw error;
	});

	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Quel est mon stock ?',
		user: USER,
		sessionId: 'sess-stock-err',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].success, false);
	assert.match(result.reply, /stock/i);
	assert.doesNotMatch(result.reply, /14/);
});

test('debts question executes get_debts from Supabase', async () => {
	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Quelles sont mes dettes ?',
		user: USER,
		sessionId: 'sess-debts-1',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].tool, 'get_debts');
	assert.match(result.reply, /40/);
	assert.equal(result.conversation.topic, 'debts');
});

test('domain switch debts to expenses to stock to sales', async () => {
	const agent = createAshyAgent();
	const sessionId = 'sess-debts-switch';

	await agent.run({
		message: 'Quelles sont mes dettes ?',
		user: USER,
		sessionId,
		referenceDate: REFERENCE_DATE,
	});

	const expenses = await agent.run({
		message: 'Et les dépenses ?',
		user: USER,
		sessionId,
		referenceDate: REFERENCE_DATE,
	});
	assert.equal(expenses.toolResults[0].tool, 'get_expenses');
	assert.match(expenses.reply, /25/);

	const stock = await agent.run({
		message: 'Et mon stock ?',
		user: USER,
		sessionId,
		referenceDate: REFERENCE_DATE,
	});
	assert.equal(stock.toolResults[0].tool, 'get_stock');

	const sales = await agent.run({
		message: 'Et les ventes ?',
		user: USER,
		sessionId,
		referenceDate: REFERENCE_DATE,
	});
	assert.equal(sales.toolResults[0].tool, 'get_sales');
	assert.match(sales.reply, /30/);
});

test('unpaid debts follow-up after debts query', async () => {
	const agent = createAshyAgent();
	const sessionId = 'sess-debts-unpaid';

	await agent.run({
		message: 'Quelles sont mes dettes ?',
		user: USER,
		sessionId,
		referenceDate: REFERENCE_DATE,
	});

	const followUp = await agent.run({
		message: 'Et celles qui sont encore impayées ?',
		user: USER,
		sessionId,
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(followUp.toolResults[0].tool, 'get_debts');
	assert.match(followUp.reply, /impay/i);
});

test('debts supabase failure never returns success reply', async () => {
	setDebtsQueryImplForTests(async () => {
		const error = new Error('db down');
		error.code = 'SUPABASE_QUERY_FAILED';
		throw error;
	});

	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Quelles sont mes dettes ?',
		user: USER,
		sessionId: 'sess-debts-err',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].success, false);
	assert.match(result.reply, /debts|dette|récupérer/i);
	assert.doesNotMatch(result.reply, /40/);
});
