#!/usr/bin/env node
/**
 * Offline Ashy Intelligence 2.0 goal classifier harness.
 * No Supabase, production, n8n, frontend, or writes.
 *
 * Usage: node tools/_ashy_v2_goal_harness.mjs
 */

import { resolveIntentRegex } from '../apps/api/src/agent/intent-resolver/regex-resolver.js';
import { classifyGoal } from '../apps/api/src/agent/intelligence-v2/goal-classifier.js';
import { mapLegacyIntentToGoal } from '../apps/api/src/agent/intelligence-v2/legacy-intent-mapper.js';

const REFERENCE_DATE = new Date('2026-09-12T12:00:00.000Z');

const SCENARIOS = [
	{ message: 'Combien ai-je vendu ce mois-ci ?' },
	{ message: 'Combien ai-je vendu cette semaine ?' },
	{
		message: 'Et le mois passé ?',
		context: { topic: 'sales', filters: { period: 'current_month' } },
	},
	{ message: 'Pourquoi mon bénéfice a baissé ?' },
	{
		message: 'Pourquoi mon bénéfice est plus faible ce mois-ci alors que j\'ai vendu plus ?',
	},
	{ message: 'Pourquoi mes dépenses ont augmenté ?' },
	{ message: 'Qu\'est-ce qui me rapporte le plus ?' },
	{ message: 'Mon stock de savon est-il bientôt épuisé ?' },
	{ message: 'Ajoute une dépense de 15$ pour le transport.' },
	{ message: 'Ajoute 5 cartons de Coca-Cola vendus à 20$.' },
	{ message: 'Compare mes ventes et mes dépenses.' },
	{
		message: 'Regarde mes ventes et mes dépenses et explique-moi pourquoi mon bénéfice baisse.',
	},
	{ message: 'Et dans mon autre activité ?' },
	{ message: 'Compare ma boutique et mon pressing.' },
	{
		message: 'Oui',
		context: { pendingWrite: { tool: 'create_expense', label: 'transport', amount: 15 } },
	},
];

function summarizeGoal(goal) {
	if (!goal) return '(null)';
	return `${goal.type}/${goal.domain}/${goal.objective}`;
}

function alignedWithLegacy(legacyGoal, classifierGoal) {
	if (!legacyGoal?.valid || !classifierGoal) return false;
	const legacy = legacyGoal.value;
	return legacy.type === classifierGoal.type
		&& legacy.domain === classifierGoal.domain
		&& legacy.objective === classifierGoal.objective;
}

console.log('ASHY INTELLIGENCE 2.0 — OFFLINE GOAL HARNESS\n');
console.log('MESSAGE | LEGACY INTENT | GOAL | PASS/FAIL');
console.log('-'.repeat(90));

let passCount = 0;

for (const scenario of SCENARIOS) {
	const context = scenario.context || {};
	const legacyResolved = resolveIntentRegex(scenario.message, context);
	const legacyGoal = mapLegacyIntentToGoal(legacyResolved, REFERENCE_DATE);
	const classifierResult = await classifyGoal(scenario.message, context, {
		referenceDate: REFERENCE_DATE,
		forceRules: true,
		legacyResolved,
	});

	const pass = classifierResult.valid
		&& (alignedWithLegacy(legacyGoal, classifierResult.goal)
			|| classifierResult.source === 'rules');

	if (pass) passCount += 1;

	const line = [
		`"${scenario.message}"`,
		legacyResolved.intent,
		`${summarizeGoal(classifierResult.goal)} [${classifierResult.source}]`,
		pass ? 'PASS' : 'FAIL',
	].join(' | ');

	console.log(line);
}

console.log('-'.repeat(90));
console.log(`\n${passCount}/${SCENARIOS.length} scenarios PASS`);
