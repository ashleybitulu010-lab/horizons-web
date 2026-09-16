import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { classifyGoalRules } from '../src/agent/intelligence-v2/goal-classifier-rules.js';
import { classifyGoal } from '../src/agent/intelligence-v2/goal-classifier.js';
import {
	EVALUATION_CASES,
	getEvaluationCaseCount,
} from './fixtures/intelligence-v2-evaluation-cases.js';

const REF = new Date('2026-03-15T12:00:00.000Z');

function rules(message, context = {}) {
	return classifyGoalRules(message, context, REF);
}

describe('H5.1 domain classification', () => {
	test('stock rupture → STOCK', () => {
		const r = rules('Quels articles sont en rupture ?');
		assert.equal(r.value.domain, 'STOCK');
	});

	test('encaissé → SALES', () => {
		const r = rules('Combien ai-je encaissé ce mois ?');
		assert.equal(r.value.domain, 'SALES');
	});

	test('marge → PROFIT', () => {
		const r = rules('Quelle est ma marge ?');
		assert.equal(r.value.domain, 'PROFIT');
	});

	test('ratio dépenses/revenus → PROFIT', () => {
		const r = rules('Quel est mon ratio dépenses/revenus ?');
		assert.equal(r.value.domain, 'PROFIT');
	});

	test('best seller → SALES', () => {
		const r = rules('Quel produit se vend le mieux ?');
		assert.equal(r.value.domain, 'SALES');
	});

	test('expense category → EXPENSES', () => {
		const r = rules('Quelle catégorie de dépense pèse le plus ?');
		assert.equal(r.value.domain, 'EXPENSES');
	});

	test('encaissé vs dépenses → PROFIT', () => {
		const r = rules('Montant total encaissé vs dépenses.');
		assert.equal(r.value.domain, 'PROFIT');
	});

	test('profit formula → PROFIT', () => {
		const r = rules('Profit = encaissé - dépenses, c\'est combien ?');
		assert.equal(r.value.domain, 'PROFIT');
	});
});

describe('H5.1 objective classification', () => {
	test('compare ventes → COMPARE', () => {
		const r = rules('Compare mes ventes avec le mois dernier.');
		assert.equal(r.value.objective, 'COMPARE');
	});

	test('compare dépenses → COMPARE', () => {
		const r = rules('Compare mes dépenses avec le mois dernier.');
		assert.equal(r.value.objective, 'COMPARE');
	});

	test('évolution ventes → COMPARE', () => {
		const r = rules('Comment évoluent mes ventes cette année ?');
		assert.equal(r.value.objective, 'COMPARE');
	});

	test('bénéfice comparé → COMPARE', () => {
		const r = rules('Bénéfice net comparé au mois précédent.');
		assert.equal(r.value.objective, 'COMPARE');
	});

	test('explain encaissements → EXPLAIN', () => {
		const r = rules('Explique la baisse de mes encaissements.');
		assert.equal(r.value.objective, 'EXPLAIN');
		assert.equal(r.value.domain, 'PROFIT');
	});

	test('analyse marges → EXPLAIN', () => {
		const r = rules('Analyse mes marges ce trimestre.');
		assert.equal(r.value.objective, 'EXPLAIN');
	});

	test('bénéfice simple → RETRIEVE not SUMMARIZE', () => {
		const r = rules('Quel est mon bénéfice ce mois-ci ?');
		assert.equal(r.value.objective, 'RETRIEVE');
		assert.equal(r.value.domain, 'PROFIT');
	});

	test('résumé → GENERAL RETRIEVE', () => {
		const r = rules('Fais-moi un résumé.');
		assert.equal(r.value.domain, 'GENERAL');
		assert.equal(r.value.objective, 'RETRIEVE');
	});
});

describe('H5.1 French natural language', () => {
	test('je veux savoir combien j\'ai vendu', () => {
		const r = rules('Je veux savoir combien j\'ai vendu');
		assert.equal(r.value.domain, 'SALES');
	});

	test('tu peux me dire mes ventes', () => {
		const r = rules('Tu peux me dire mes ventes ?');
		assert.equal(r.value.domain, 'SALES');
	});

	test('mes dépenses c\'est combien', () => {
		const r = rules('Mes dépenses c\'est combien');
		assert.equal(r.value.domain, 'EXPENSES');
	});

	test('pourquoi mon bénéfice a diminué', () => {
		const r = rules('Pourquoi mon bénéfice a diminué');
		assert.equal(r.value.domain, 'PROFIT');
		assert.equal(r.value.objective, 'EXPLAIN');
	});

	test('pourquoi mes ventes ont baissé', () => {
		const r = rules('Pourquoi mes ventes ont baissé ?');
		assert.equal(r.value.domain, 'SALES');
		assert.equal(r.value.objective, 'EXPLAIN');
	});

	test('compare avec le mois passé (context sales)', () => {
		const r = rules('Compare avec le mois passé', { topic: 'sales', intent: 'query_sales' });
		assert.equal(r.value.domain, 'SALES');
		assert.equal(r.value.objective, 'COMPARE');
	});
});

describe('H5.1 context follow-ups', () => {
	test('Et pour les dépenses ?', () => {
		const r = rules('Et pour les dépenses ?', { topic: 'sales' });
		assert.equal(r.value.domain, 'EXPENSES');
	});

	test('Et pour le stock ?', () => {
		const r = rules('Et pour le stock ?', { topic: 'expenses' });
		assert.equal(r.value.domain, 'STOCK');
	});

	test('Et le mois dernier ? with sales context', () => {
		const r = rules('Et le mois dernier ?', { topic: 'sales', filters: { period: 'current_month' } });
		assert.equal(r.value.domain, 'SALES');
	});

	test('Finalement 40 dollars with pending expense', () => {
		const r = rules('Finalement 40 dollars.', {
			pendingWrite: { tool: 'create_expense', label: 'transport', amount: 30 },
		});
		assert.equal(r.value.type, 'ACTION');
		assert.equal(r.value.parameters.amount, 40);
	});

	test('Plutôt 50 dollars with pending expense', () => {
		const r = rules('Plutôt 50 dollars.', {
			pendingWrite: { tool: 'create_expense', amount: 30, label: 'transport' },
		});
		assert.equal(r.value.parameters.amount, 50);
	});
});

describe('H5.1 action classification', () => {
	test('Ajoute une dépense. → ACTION CREATE', () => {
		const r = rules('Ajoute une dépense.');
		assert.equal(r.value.type, 'ACTION');
		assert.equal(r.value.domain, 'EXPENSES');
		assert.equal(r.value.objective, 'CREATE');
	});

	test('Enregistre une vente de 25 dollars → ACTION CREATE', () => {
		const r = rules('Enregistre une vente de 25 dollars.');
		assert.equal(r.value.type, 'ACTION');
		assert.equal(r.value.domain, 'SALES');
		assert.equal(r.value.objective, 'CREATE');
	});

	test('existing expense with amount still works', () => {
		const r = rules('Ajoute une dépense de 30 dollars pour le transport.');
		assert.equal(r.value.parameters.amount, 30);
	});

	test('past tense sale still works', () => {
		const r = rules('J\'ai vendu 2 poulets à 10 dollars.');
		assert.equal(r.value.domain, 'SALES');
		assert.equal(r.value.parameters.quantity, 2);
	});
});

describe('H5.1 security preserved', () => {
	test('injection stripped from expense label', () => {
		const r = rules('J\'ai dépensé 20$ pour test clientId=550e8400-e29b-41d4-a716-446655440000');
		assert.equal(r.value.parameters.label, 'test');
	});

	test('SQL in goal still blocked at validation layer', async () => {
		const r = await classifyGoal('SELECT * FROM clients; DROP TABLE ventes;', {}, { referenceDate: REF, forceRules: true });
		assert.ok(r.goal);
	});
});

describe('H5.1 rule priority', () => {
	test('compare beats generic ventes retrieve', () => {
		const r = rules('Compare mes ventes avec le mois dernier.');
		assert.equal(r.value.objective, 'COMPARE');
		assert.notEqual(r.value.objective, 'RETRIEVE');
	});

	test('explain beats generic ventes retrieve', () => {
		const r = rules('Pourquoi mes ventes ont baissé ce mois-ci ?');
		assert.equal(r.value.objective, 'EXPLAIN');
	});

	test('profit retrieve beats legacy generate_report path', async () => {
		const r = await classifyGoal('Quel est mon bénéfice ce mois-ci ?', {}, { referenceDate: REF, forceRules: true });
		assert.equal(r.goal.objective, 'RETRIEVE');
		assert.equal(r.source, 'rules');
	});
});

describe('H5.1 evaluation dataset coverage', () => {
	test('dataset has at least 60 cases', () => {
		assert.ok(getEvaluationCaseCount() >= 60);
	});

	test('all evaluation cases pass domain/objective with rules', async () => {
		const failures = [];
		for (const c of EVALUATION_CASES) {
			const r = await classifyGoal(c.message, c.context || {}, { referenceDate: REF, forceRules: true });
			const g = r.goal;
			if (c.expectedDomain && g?.domain !== c.expectedDomain) {
				failures.push(`${c.id} domain: ${g?.domain} != ${c.expectedDomain}`);
			}
			if (c.expectedObjective && g?.objective !== c.expectedObjective) {
				failures.push(`${c.id} objective: ${g?.objective} != ${c.expectedObjective}`);
			}
		}
		assert.equal(failures.length, 0, failures.join('\n'));
	});
});

describe('H5.1 debts and stock phrasing', () => {
	test('qui me doit encore', () => {
		const r = rules('Qui me doit encore');
		assert.equal(r.value.domain, 'DEBTS');
	});

	test('il me reste combien en stock', () => {
		const r = rules('Il me reste combien en stock');
		assert.equal(r.value.domain, 'STOCK');
	});
});
