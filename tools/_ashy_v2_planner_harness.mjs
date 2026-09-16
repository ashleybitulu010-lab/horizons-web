#!/usr/bin/env node
/**
 * Offline Ashy Intelligence 2.0 planner harness.
 * MESSAGE → GOAL → PLAN → STEPS → PASS/FAIL
 */

import { resolveIntentRegex } from '../apps/api/src/agent/intent-resolver/regex-resolver.js';
import { classifyGoal } from '../apps/api/src/agent/intelligence-v2/goal-classifier.js';
import { buildAnalysisPlanFromGoal } from '../apps/api/src/agent/intelligence-v2/plan-builder.js';

const REFERENCE_DATE = new Date('2026-09-12T12:00:00.000Z');

const SCENARIOS = [
	{ message: 'Combien ai-je vendu ce mois-ci ?', expectSteps: 1 },
	{
		message: 'Pourquoi mon bénéfice est plus faible ce mois-ci alors que j\'ai vendu plus ?',
		expectSteps: 4,
	},
	{ message: 'Pourquoi mes dépenses ont augmenté ?', expectSteps: 2 },
	{ message: 'Ajoute une dépense de 15$ pour le transport.', expectSteps: 1, write: true },
	{ message: 'Compare mes ventes et mes dépenses.', expectSteps: 2 },
];

function summarizeGoal(goal) {
	if (!goal) return '(null)';
	return `${goal.type}/${goal.domain}/${goal.objective}`;
}

function summarizeSteps(plan) {
	if (!plan?.steps) return '(none)';
	return plan.steps.map((step) => `${step.id}:${step.tool}`).join(', ');
}

console.log('ASHY INTELLIGENCE 2.0 — PLANNER HARNESS\n');
console.log('MESSAGE | GOAL | STEPS | PASS/FAIL');
console.log('-'.repeat(100));

let passCount = 0;

for (const scenario of SCENARIOS) {
	const legacyResolved = resolveIntentRegex(scenario.message, scenario.context || {});
	const classifier = await classifyGoal(scenario.message, scenario.context || {}, {
		referenceDate: REFERENCE_DATE,
		forceRules: true,
		legacyResolved,
	});

	const planResult = classifier.goal
		? buildAnalysisPlanFromGoal(classifier.goal, scenario.context || {})
		: { success: false };

	const stepCount = planResult.plan?.steps?.length || 0;
	const pass = planResult.success
		&& stepCount === scenario.expectSteps
		&& (scenario.write ? planResult.plan.requiresConfirmation === true : planResult.plan.requiresConfirmation === false);

	if (pass) passCount += 1;

	console.log([
		`"${scenario.message}"`,
		summarizeGoal(classifier.goal),
		summarizeSteps(planResult.plan),
		pass ? 'PASS' : 'FAIL',
	].join(' | '));
}

console.log('-'.repeat(100));
console.log(`\n${passCount}/${SCENARIOS.length} scenarios PASS`);
