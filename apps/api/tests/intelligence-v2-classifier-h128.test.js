import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyGoalRules } from '../src/agent/intelligence-v2/goal-classifier-rules.js';

const REF = new Date('2026-09-12T12:00:00.000Z');

function classify(message, context = {}) {
	return classifyGoalRules(message, context, REF);
}

const REPORT_TEXT = [
	'Fais-moi un rapport',
	'Fais-moi un rapport financier',
	'Fais-moi un bilan',
	'Donne-moi un bilan',
	'Donne-moi un bilan de mon activité',
	'Fais-moi le résumé de mon activité',
	'Résumé financier',
	'Donne-moi un résumé financier',
	'Fais-moi le bilan du mois',
	'Je peux avoir mon bilan',
];

for (const message of REPORT_TEXT) {
	test(`H12.8 classifier report text — ${message}`, () => {
		const result = classify(message);
		assert.equal(result.valid, true, message);
		assert.equal(result.value.domain, 'GENERAL', message);
		assert.equal(result.value.objective, 'SUMMARIZE', message);
		assert.equal(result.value.type, 'ANALYSIS', message);
	});
}

test('H12.8 profit regression — bénéfice stays PROFIT', () => {
	const result = classify('Quel est mon bénéfice ?');
	assert.equal(result.valid, true);
	assert.equal(result.value.domain, 'PROFIT');
	assert.equal(result.value.objective, 'RETRIEVE');
});

test('H12.8 analysis regression — analyse stays GENERAL SUMMARIZE', () => {
	const result = classify('Analyse mes résultats');
	assert.equal(result.valid, true);
	assert.equal(result.value.domain, 'GENERAL');
	assert.equal(result.value.objective, 'SUMMARIZE');
});

test('H12.8 analysis regression — explain stays PROFIT EXPLAIN', () => {
	const result = classify('Pourquoi mon bénéfice a changé ?');
	assert.equal(result.valid, true);
	assert.equal(result.value.domain, 'PROFIT');
	assert.equal(result.value.objective, 'EXPLAIN');
});

test('H12.8 write safety — expense create not report', () => {
	const result = classify('Ajoute une dépense de 30 dollars');
	assert.equal(result.valid, true);
	assert.equal(result.value.type, 'ACTION');
	assert.equal(result.value.domain, 'EXPENSES');
});
