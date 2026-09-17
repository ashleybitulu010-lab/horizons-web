import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyGoal } from '../src/agent/intelligence-v2/goal-classifier.js';
import { buildActionProposalFromGoal } from '../src/agent/intelligence-v2/action/action-proposal-builder.js';
import { ACTION_PROPOSAL_STATUS } from '../src/agent/intelligence-v2/action/action-proposal-contract.js';
import { parseClarificationFollowUp } from '../src/agent/intelligence-v2/action/action-confirmation-handler.js';

const REFERENCE_DATE = new Date('2026-09-12T12:00:00.000Z');

async function classify(message, context = {}) {
	return classifyGoal(message, context, {
		referenceDate: REFERENCE_DATE,
		forceRules: true,
	});
}

function assertAction(result, { domain, objective = 'CREATE', label }) {
	assert.equal(result.valid, true, label);
	assert.equal(result.goal.type, 'ACTION', label);
	assert.equal(result.goal.domain, domain, label);
	assert.equal(result.goal.objective, objective, label);
	assert.equal(result.source, 'rules', label);
}

function assertNotAction(result, label) {
	assert.equal(result.valid, true, label);
	assert.notEqual(result.goal.type, 'ACTION', `${label} must not be ACTION`);
}

const INCOMPLETE_EXPENSES = [
	"J'ai dépensé de l'argent pour le transport.",
	"J'ai dépensé de l'argent.",
	"J'ai dépensé pour le transport.",
	"J'ai dépensé de l'argent pour le transport hier.",
];

for (const message of INCOMPLETE_EXPENSES) {
	test(`H10.1 incomplete expense → NEEDS_CLARIFICATION — ${message}`, async () => {
		const result = await classify(message);
		assertAction(result, { domain: 'EXPENSES', label: message });
		const proposal = buildActionProposalFromGoal(result.goal);
		assert.equal(proposal.valid, true);
		assert.equal(proposal.value.status, ACTION_PROPOSAL_STATUS.NEEDS_CLARIFICATION);
	});
}

test('H10.1 complete expense stays READY_FOR_CONFIRMATION', async () => {
	const result = await classify("J'ai dépensé 30 dollars pour le transport.");
	assertAction(result, { domain: 'EXPENSES', label: 'complete expense' });
	const proposal = buildActionProposalFromGoal(result.goal);
	assert.equal(proposal.value.status, ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION);
	assert.equal(proposal.value.fields.amount, 30);
});

const SALE_ACTIONS = [
	"J'ai vendu 1 poulet à 2 dollars.",
	"J'ai vendu 1 poulet à 2 dollars pour test Ashy H10.",
	"J'ai vendu 2 poulets à 30 dollars.",
	"J'ai vendu un produit pour 10 dollars.",
	"Je viens de vendre 2 poulets à 30 dollars.",
	"Une vente de 2 poulets à 30 dollars.",
	"J'ai fait une vente de 2 poulets à 30 dollars.",
];

for (const message of SALE_ACTIONS) {
	test(`H10.1 sale action — ${message}`, async () => {
		const result = await classify(message);
		assertAction(result, { domain: 'SALES', label: message });
		const proposal = buildActionProposalFromGoal(result.goal);
		assert.equal(proposal.valid, true);
		assert.notEqual(proposal.value.status, ACTION_PROPOSAL_STATUS.NEEDS_CLARIFICATION);
	});
}

const READ_REGRESSION = [
	{ message: 'Quelles sont mes ventes ?', type: 'QUESTION', domain: 'SALES' },
	{ message: 'Quel est mon stock ?', type: 'QUESTION', domain: 'STOCK' },
	{ message: 'Quels sont mes produits ?', type: 'QUESTION', domain: 'PRODUCTS' },
	{ message: 'Compare mes ventes.', type: 'ANALYSIS', domain: 'SALES' },
	{ message: 'Qui me doit de l\'argent ?', type: 'QUESTION', domain: 'DEBTS' },
	{ message: 'Quel est mon bénéfice ?', type: 'QUESTION', domain: 'PROFIT' },
];

for (const sample of READ_REGRESSION) {
	test(`H10.1 READ regression — ${sample.message}`, async () => {
		const result = await classify(sample.message);
		assert.equal(result.valid, true);
		assert.equal(result.goal.type, sample.type, sample.message);
		assert.equal(result.goal.domain, sample.domain, sample.message);
	});
}

test('H10.1 natural language expense variants with amount', async () => {
	for (const message of [
		"Je viens de dépenser 15 dollars pour le carburant.",
		"J'ai payé 20 dollars pour l'eau.",
	]) {
		const result = await classify(message);
		assertAction(result, { domain: 'EXPENSES', label: message });
	}
});

test('H10.1 natural language expense without amount', async () => {
	for (const message of [
		"Je viens de dépenser de l'argent pour le transport.",
		"J'ai payé pour le transport.",
	]) {
		const result = await classify(message);
		assertAction(result, { domain: 'EXPENSES', label: message });
		const proposal = buildActionProposalFromGoal(result.goal);
		assert.equal(proposal.value.status, ACTION_PROPOSAL_STATUS.NEEDS_CLARIFICATION);
	}
});

test('H10.2 multi-turn amount then label follow-up', async () => {
	const first = await classify("J'ai dépensé 30 dollars.");
	assertAction(first, { domain: 'EXPENSES', label: 'amount-first' });
	const draft = buildActionProposalFromGoal(first.goal).value;
	const followUp = parseClarificationFollowUp('pour le transport.', {
		tool: 'create_expense',
		label: draft.fields.label,
		amount: draft.fields.amount,
	});
	assert.deepEqual(followUp, { label: 'le transport' });
});

test('H10.1 multi-turn clarification follow-up', async () => {
	const first = await classify("J'ai dépensé de l'argent.");
	assertAction(first, { domain: 'EXPENSES', label: 'multi-turn start' });
	const draft = buildActionProposalFromGoal(first.goal).value;
	const draftPending = {
		tool: 'create_expense',
		label: draft.fields.label,
		amount: draft.fields.amount,
	};
	const followUp = parseClarificationFollowUp('30 dollars.', draftPending);
	assert.deepEqual(followUp, { amount: 30 });
	const merged = { ...draftPending, ...followUp };
	const proposal = buildActionProposalFromGoal({
		type: 'ACTION',
		domain: 'EXPENSES',
		objective: 'CREATE',
		period: null,
		comparison: null,
		activityReference: null,
		parameters: {
			label: merged.label,
			amount: merged.amount,
			confirmed: false,
		},
	});
	assert.equal(proposal.value.status, ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION);
});

test('H10.1 security — injected UUID stripped from label', async () => {
	const result = await classify("J'ai dépensé 10 dollars pour 550e8400-e29b-41d4-a716-446655440000.");
	assertAction(result, { domain: 'EXPENSES', label: 'uuid label attempt' });
	const proposal = buildActionProposalFromGoal(result.goal);
	assert.equal(proposal.valid, true);
	const label = proposal.value.fields.label;
	assert.equal(label == null || !String(label).includes('550e8400'), true);
});

test('H10.1 security — scope fields not accepted from message', async () => {
	const poison = "J'ai dépensé 10 dollars pour client_id=00000000-0000-0000-0000-000000000099";
	const result = await classify(poison);
	assertAction(result, { domain: 'EXPENSES', label: 'scope poison' });
	assert.equal(result.goal.parameters.clientId, undefined);
	assert.equal(result.goal.parameters.activityId, undefined);
});

test('H10.1 empty catalog sale still ACTION at classifier level', async () => {
	const result = await classify("J'ai vendu 1 poulet à 2 dollars.");
	assertAction(result, { domain: 'SALES', label: 'empty catalog sale intent' });
	assert.notEqual(result.goal.type, 'QUESTION');
});
