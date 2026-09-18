import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyGoalRules } from '../src/agent/intelligence-v2/goal-classifier-rules.js';

const REF = new Date('2026-09-12T12:00:00.000Z');

function classify(message, context = {}) {
	return classifyGoalRules(message, context, REF);
}

const PROFIT_READ = [
	{ message: 'Quel est mon bénéfice ?', domain: 'PROFIT', objective: 'RETRIEVE', type: 'QUESTION' },
	{ message: 'Combien ai-je gagné ?', domain: 'PROFIT', objective: 'RETRIEVE', type: 'QUESTION' },
	{ message: 'Quel est mon profit ?', domain: 'PROFIT', objective: 'RETRIEVE', type: 'QUESTION' },
	{ message: 'Quelle est ma marge ?', domain: 'PROFIT', objective: 'RETRIEVE', type: 'QUESTION' },
];

const ANALYSIS = [
	{ message: 'Analyse mes résultats', domain: 'GENERAL', objective: 'SUMMARIZE', type: 'ANALYSIS' },
	{ message: 'Comment vont mes finances ?', domain: 'GENERAL', objective: 'SUMMARIZE', type: 'ANALYSIS' },
	{ message: 'Pourquoi mon bénéfice a changé ?', domain: 'PROFIT', objective: 'EXPLAIN', type: 'ANALYSIS' },
];

const COMPARE = [
	{ message: 'Compare mon bénéfice avec le mois passé', domain: 'PROFIT', objective: 'COMPARE', type: 'ANALYSIS' },
	{ message: 'Mon bénéfice a-t-il augmenté ?', domain: 'PROFIT', objective: 'RETRIEVE', type: 'QUESTION' },
	{ message: 'Compare mes dépenses et mes revenus', domain: 'EXPENSES', objective: 'COMPARE', type: 'ANALYSIS' },
];

const COLLISION = [
	{ message: 'Combien ai-je vendu ?', domain: 'SALES', objective: 'RETRIEVE', type: 'QUESTION' },
	{ message: 'Combien ai-je dépensé ?', domain: 'EXPENSES', objective: 'RETRIEVE', type: 'QUESTION' },
	{ message: 'Comment évoluent mes ventes ?', domain: 'SALES', objective: 'COMPARE', type: 'ANALYSIS' },
	{ message: 'Comment évoluent mes dépenses ?', domain: 'EXPENSES', objective: 'COMPARE', type: 'ANALYSIS' },
];

for (const c of [...PROFIT_READ, ...ANALYSIS, ...COMPARE, ...COLLISION]) {
	test(`H12.6 classifier — ${c.message}`, () => {
		const result = classify(c.message);
		assert.equal(result.valid, true, c.message);
		assert.equal(result.value.domain, c.domain, c.message);
		assert.equal(result.value.objective, c.objective, c.message);
		assert.equal(result.value.type, c.type, c.message);
	});
}

test('H12.6 ratio query maps to PROFIT expense_ratio metric', () => {
	const result = classify('Quel pourcentage de mes revenus part dans les dépenses ?');
	assert.equal(result.valid, true);
	assert.equal(result.value.domain, 'PROFIT');
	assert.equal(result.value.objective, 'RETRIEVE');
	assert.equal(result.value.parameters?.metric, 'expense_ratio');
});

test('H12.6 profit trend maps to PROFIT COMPARE', () => {
	const result = classify('Comment évolue mon bénéfice ?');
	assert.equal(result.valid, true);
	assert.equal(result.value.domain, 'PROFIT');
	assert.equal(result.value.objective, 'COMPARE');
	assert.equal(result.value.type, 'ANALYSIS');
});

test('H12.6 revenue evolution maps to SALES COMPARE', () => {
	const result = classify('Quelle est l\'évolution de mon chiffre d\'affaires ?');
	assert.equal(result.valid, true);
	assert.equal(result.value.domain, 'SALES');
	assert.equal(result.value.objective, 'COMPARE');
	assert.equal(result.value.type, 'ANALYSIS');
});
