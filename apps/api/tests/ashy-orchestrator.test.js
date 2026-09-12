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
import {
	setProductsQueryImplForTests,
	resetProductsQueryImplForTests,
} from '../src/services/products-service.js';
import {
	setCreateSaleImplForTests,
	resetCreateSaleImplForTests,
} from '../src/services/sales-write-service.js';
import {
	setCreateExpenseImplForTests,
	resetCreateExpenseImplForTests,
} from '../src/services/expenses-write-service.js';

const USER = {
	id: 'pb_user',
	clientId: 'client_1',
	activeActivityId: 'activity_1',
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

function productRows() {
	return [{
		id: 'prod-1',
		client_id: 'client_1',
		nom_produit: 'Savon',
		categorie: 'Hygiène',
		prix_achat_unitaire: 500,
		prix_vente_unitaire: 800,
		created_at: '2026-08-01T10:00:00.000Z',
	}, {
		id: 'prod-2',
		client_id: 'client_1',
		nom_produit: 'Cahiers',
		categorie: 'Fournitures',
		prix_achat_unitaire: 200,
		prix_vente_unitaire: 350,
		created_at: '2026-08-02T10:00:00.000Z',
	}];
}

test.beforeEach(() => {
	clearConversationSessionsForTests();
	setSalesQueryImplForTests(async (_clientId, _range, input) => salesForPeriod(input.period));
	setExpensesQueryImplForTests(async (_clientId, _range, input) => expensesForPeriod(input.period));
	setStockQueryImplForTests(async () => ({ stocks: stockRows(), products: [] }));
	setDebtsQueryImplForTests(async () => debtsRows());
	setProductsQueryImplForTests(async (_clientId, input) => {
		let rows = productRows();
		if (input.product) {
			const needle = input.product.toLowerCase();
			rows = rows.filter((row) => String(row.nom_produit).toLowerCase().includes(needle));
		}
		if (input.category) {
			const needle = input.category.toLowerCase();
			rows = rows.filter((row) => String(row.categorie || '').toLowerCase().includes(needle));
		}
		return rows;
	});
});

test.afterEach(() => {
	clearConversationSessionsForTests();
	resetSalesQueryImplForTests();
	resetExpensesQueryImplForTests();
	resetStockQueryImplForTests();
	resetDebtsQueryImplForTests();
	resetProductsQueryImplForTests();
	resetCreateSaleImplForTests();
	resetCreateExpenseImplForTests();
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

	clearConversationState(USER.id, 'sess-clear', USER.activeActivityId);
	assert.equal(getConversationState(USER.id, 'sess-clear', USER.activeActivityId).topic, null);

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

	const stored = getConversationState(USER.id, 'sess-mem', USER.activeActivityId);
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

test('products question executes get_products from Supabase', async () => {
	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Quels sont mes produits ?',
		user: USER,
		sessionId: 'sess-products-1',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].tool, 'get_products');
	assert.match(result.reply, /Savon/i);
	assert.match(result.reply, /800/);
	assert.equal(result.conversation.topic, 'products');
});

test('products search filters catalogue result', async () => {
	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Mes produits savon',
		user: USER,
		sessionId: 'sess-products-search',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].tool, 'get_products');
	assert.match(result.reply, /Savon/i);
	assert.doesNotMatch(result.reply, /Cahiers/i);
});

test('products category filters catalogue result', async () => {
	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Quels sont mes produits de la catégorie Fournitures ?',
		user: USER,
		sessionId: 'sess-products-category',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].tool, 'get_products');
	assert.match(result.reply, /Cahiers/i);
	assert.doesNotMatch(result.reply, /Savon/i);
});

test('domain switch products to stock', async () => {
	const agent = createAshyAgent();
	const sessionId = 'sess-products-switch';

	await agent.run({
		message: 'Quels sont mes produits ?',
		user: USER,
		sessionId,
		referenceDate: REFERENCE_DATE,
	});

	const stock = await agent.run({
		message: 'Quel est mon stock ?',
		user: USER,
		sessionId,
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(stock.toolResults[0].tool, 'get_stock');
	assert.match(stock.reply, /14/);
});

test('products supabase failure never returns success reply', async () => {
	setProductsQueryImplForTests(async () => {
		const error = new Error('db down');
		error.code = 'SUPABASE_QUERY_FAILED';
		throw error;
	});

	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Liste mes produits',
		user: USER,
		sessionId: 'sess-products-err',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].success, false);
	assert.match(result.reply, /products|catalogue|produits|récupérer/i);
	assert.doesNotMatch(result.reply, /Savon/i);
});

test('empty products catalogue returns explicit reply', async () => {
	setProductsQueryImplForTests(async () => []);

	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Quels sont mes produits ?',
		user: USER,
		sessionId: 'sess-products-empty',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].success, true);
	assert.equal(result.toolResults[0].summary.count, 0);
	assert.match(result.reply, /Aucun produit/i);
});

test('report question executes generate_report from Supabase', async () => {
	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Quel est mon bénéfice ce mois-ci ?',
		user: USER,
		sessionId: 'sess-report-1',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].tool, 'generate_report');
	assert.equal(result.toolResults[0].success, true);
	assert.equal(result.toolResults[0].summary.estimatedProfit, 5);
	assert.match(result.reply, /bénéfice estimé de 5/i);
	assert.match(result.reply, /40/);
	assert.match(result.reply, /stock faible/i);
	assert.equal(result.conversation.topic, 'report');
});

test('bilan text request stays read-only and avoids PDF', async () => {
	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Je peux avoir mon bilan',
		user: USER,
		sessionId: 'sess-report-2',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].tool, 'generate_report');
	assert.doesNotMatch(result.reply, /PDF/i);
});

test('pdf report request returns clarification without tool execution', async () => {
	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Envoie-moi mon bilan du mois en PDF',
		user: USER,
		sessionId: 'sess-report-pdf',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults.length, 0);
	assert.match(result.reply, /PDF/i);
});

test('report supabase failure never returns success reply', async () => {
	setSalesQueryImplForTests(async () => {
		const error = new Error('db down');
		error.code = 'SUPABASE_QUERY_FAILED';
		throw error;
	});

	const agent = createAshyAgent();
	const result = await agent.run({
		message: 'Fais-moi un bilan',
		user: USER,
		sessionId: 'sess-report-err',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].success, false);
	assert.match(result.reply, /report|résumé|activité|récupérer/i);
	assert.doesNotMatch(result.reply, /bénéfice estimé de 5/i);
});

test('create sale message asks for confirmation before write', async () => {
	const agent = createAshyAgent();
	const result = await agent.run({
		message: "J'ai vendu 2 poulets à 10 $, payé 20 $",
		user: USER,
		sessionId: 'sess-sale-confirm',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults.length, 1);
	assert.equal(result.toolResults[0].tool, 'create_sale');
	assert.equal(result.toolResults[0].success, false);
	assert.equal(result.toolResults[0].error.code, 'NEEDS_CONFIRMATION');
	assert.match(result.reply, /Je vais enregistrer 2 poulets/i);
	assert.match(result.reply, /Je confirme/i);

	const stored = getConversationState(USER.id, 'sess-sale-confirm', USER.activeActivityId);
	assert.equal(stored.pendingWrite?.tool, 'create_sale');
	assert.equal(stored.pendingWrite?.quantity, 2);
	assert.equal(stored.pendingWrite?.product, 'poulets');
});

test('create sale confirmation executes atomic write', async () => {
	setCreateSaleImplForTests(async (scope, input) => {
		assert.equal(scope.clientId, 'client_1');
		assert.equal(input.confirmed, true);
		return {
			saleId: 'sale-1',
			product: input.product,
			quantity: input.quantity,
			unitPrice: input.unitPrice || 10,
			amountPaid: input.amountPaid,
			total: input.quantity * (input.unitPrice || 10),
			stockRemaining: 3,
			stockThreshold: 5,
			stockAlert: '⚠️ Ton stock est très faible (3 poulets restants), pense à te réapprovisionner.',
		};
	});

	const agent = createAshyAgent();
	const sessionId = 'sess-sale-flow';

	await agent.run({
		message: "J'ai vendu 2 poulets à 10 $, payé 20 $",
		user: USER,
		sessionId,
		referenceDate: REFERENCE_DATE,
	});

	const confirmed = await agent.run({
		message: 'oui',
		user: USER,
		sessionId,
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(confirmed.toolResults[0].success, true);
	assert.equal(confirmed.toolResults[0].tool, 'create_sale');
	assert.match(confirmed.reply, /Vente enregistrée/i);
	assert.match(confirmed.reply, /stock est très faible/i);

	const stored = getConversationState(USER.id, sessionId, USER.activeActivityId);
	assert.equal(stored.pendingWrite, null);
});

test('create sale insufficient stock never returns success reply', async () => {
	setCreateSaleImplForTests(async () => {
		const error = new Error('stock insuffisant pour vente poulets (0 < 2)');
		error.code = 'INSUFFICIENT_STOCK';
		error.available = 0;
		error.requested = 2;
		throw error;
	});

	const agent = createAshyAgent();
	const sessionId = 'sess-sale-stock-err';

	await agent.run({
		message: "J'ai vendu 2 poulets à 10 $, payé 20 $",
		user: USER,
		sessionId,
		referenceDate: REFERENCE_DATE,
	});

	const result = await agent.run({
		message: 'oui',
		user: USER,
		sessionId,
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults[0].success, false);
	assert.equal(result.toolResults[0].error.code, 'INSUFFICIENT_STOCK');
	assert.match(result.reply, /plus de poulets en stock/i);
	assert.doesNotMatch(result.reply, /Vente enregistrée/i);
});

test('create sale clarification when amount paid is missing', async () => {
	const agent = createAshyAgent();
	const result = await agent.run({
		message: "J'ai vendu 2 poulets à 10 $",
		user: USER,
		sessionId: 'sess-sale-clarify',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults.length, 0);
	assert.match(result.reply, /Combien as-tu encaissé/i);
});

test('create expense message asks for confirmation before write', async () => {
	const agent = createAshyAgent();
	const result = await agent.run({
		message: "J'ai dépensé 20 $ pour le transport",
		user: USER,
		sessionId: 'sess-expense-confirm',
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(result.toolResults.length, 1);
	assert.equal(result.toolResults[0].tool, 'create_expense');
	assert.equal(result.toolResults[0].success, false);
	assert.equal(result.toolResults[0].error.code, 'NEEDS_CONFIRMATION');
	assert.match(result.reply, /dépense de .*20.*transport/i);
	assert.match(result.reply, /Je confirme/i);

	const stored = getConversationState(USER.id, 'sess-expense-confirm', USER.activeActivityId);
	assert.equal(stored.pendingWrite?.tool, 'create_expense');
	assert.equal(stored.pendingWrite?.amount, 20);
	assert.equal(stored.pendingWrite?.label, 'transport');
});

test('create expense confirmation executes atomic write', async () => {
	setCreateExpenseImplForTests(async (scope, input) => {
		assert.equal(scope.clientId, 'client_1');
		assert.equal(input.confirmed, true);
		return {
			expenseId: 'expense-1',
			label: input.label,
			amount: input.amount,
		};
	});

	const agent = createAshyAgent();
	const sessionId = 'sess-expense-flow';

	await agent.run({
		message: "J'ai dépensé 20 $ pour le transport",
		user: USER,
		sessionId,
		referenceDate: REFERENCE_DATE,
	});

	const confirmed = await agent.run({
		message: 'oui',
		user: USER,
		sessionId,
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(confirmed.toolResults[0].success, true);
	assert.equal(confirmed.toolResults[0].tool, 'create_expense');
	assert.match(confirmed.reply, /Dépense enregistrée/i);

	const stored = getConversationState(USER.id, sessionId, USER.activeActivityId);
	assert.equal(stored.pendingWrite, null);
});

test('create expense slot-fill after missing label', async () => {
	const agent = createAshyAgent();
	const sessionId = 'sess-expense-slot';

	const first = await agent.run({
		message: "J'ai dépensé 20 $",
		user: USER,
		sessionId,
		referenceDate: REFERENCE_DATE,
	});

	assert.match(first.reply, /C'était pour quoi/i);

	const second = await agent.run({
		message: 'transport',
		user: USER,
		sessionId,
		referenceDate: REFERENCE_DATE,
	});

	assert.equal(second.toolResults[0].tool, 'create_expense');
	assert.equal(second.toolResults[0].error.code, 'NEEDS_CONFIRMATION');
	assert.match(second.reply, /transport/i);
});
