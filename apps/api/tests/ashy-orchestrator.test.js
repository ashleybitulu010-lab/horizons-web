import assert from 'node:assert/strict';
import test from 'node:test';

import { createAshyAgent } from '../src/agent/index.js';
import {
	clearConversationSessionsForTests,
	clearConversationState,
	getConversationState,
} from '../src/agent/conversation-state.js';
import { setSalesQueryImplForTests, resetSalesQueryImplForTests } from '../src/services/sales-service.js';

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

test.beforeEach(() => {
	clearConversationSessionsForTests();
	setSalesQueryImplForTests(async (_clientId, _range, input) => salesForPeriod(input.period));
});

test.afterEach(() => {
	clearConversationSessionsForTests();
	resetSalesQueryImplForTests();
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

test('expenses question switches topic away from sales', async () => {
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
	assert.equal(expenses.toolResults.length, 0);
	assert.match(expenses.reply, /dépenses/i);
	assert.doesNotMatch(expenses.reply, /30/);
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
