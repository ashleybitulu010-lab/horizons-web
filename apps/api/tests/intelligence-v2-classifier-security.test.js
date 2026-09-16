import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
	buildActionProposalFromGoal,
} from '../src/agent/intelligence-v2/action/action-proposal-builder.js';
import {
	containsInjectedControlMetadata,
	sanitizeBusinessFieldValue,
	stripControlMetadataFromBusinessText,
} from '../src/agent/intelligence-v2/business-field-sanitizer.js';
import { classifyGoalRules } from '../src/agent/intelligence-v2/goal-classifier-rules.js';
import { validateGoal } from '../src/agent/intelligence-v2/goal-contract.js';
import { assertActivityOwnership, assertClientOwnership } from '../src/services/supabase-scoped.js';

const SAMPLE_UUID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function classifyExpense(message) {
	return classifyGoalRules(message);
}

function serializedGoal(result) {
	return JSON.stringify(result?.value || result || {});
}

test('A — UUID injection stripped from expense label', () => {
	const result = classifyExpense(
		`J'ai dépensé 20$ pour test clientId=${SAMPLE_UUID} activityId=${OTHER_UUID} userId=${SAMPLE_UUID}`,
	);
	assert.equal(result.valid, true);
	assert.equal(result.value.parameters.label, 'test');
	assert.equal(serializedGoal(result).includes(SAMPLE_UUID), false);
});

test('B — clientId injection stripped from label', () => {
	const result = classifyExpense(
		`Enregistre une dépense de 15$ pour transport clientId=${SAMPLE_UUID}`,
	);
	assert.equal(result.valid, true);
	assert.equal(result.value.parameters.label, 'transport');
	assert.equal(result.value.parameters.label.includes('clientId'), false);
});

test('C — activityId injection stripped from label', () => {
	const result = classifyExpense(
		`J'ai dépensé 12$ pour repas activityId=${SAMPLE_UUID}`,
	);
	assert.equal(result.valid, true);
	assert.equal(result.value.parameters.label, 'repas');
});

test('D — userId injection stripped from label', () => {
	const result = classifyExpense(
		`J'ai dépensé 18$ pour café user_id=${SAMPLE_UUID}`,
	);
	assert.equal(result.valid, true);
	assert.equal(result.value.parameters.label, 'café');
});

test('E — operationId injection stripped from label', () => {
	const result = classifyExpense(
		`J'ai dépensé 22$ pour fournitures operationId=${SAMPLE_UUID}`,
	);
	assert.equal(result.valid, true);
	assert.equal(result.value.parameters.label, 'fournitures');
});

test('F — mixed-case injection stripped from label', () => {
	const result = classifyExpense(
		`J'ai dépensé 30$ pour test CLIENTID=${SAMPLE_UUID} ActivityID=${OTHER_UUID} userID=${SAMPLE_UUID}`,
	);
	assert.equal(result.valid, true);
	assert.equal(result.value.parameters.label, 'test');
	assert.equal(serializedGoal(result).includes(SAMPLE_UUID), false);
});

test('G — SQL/control injection blocked at goal validation', () => {
	const sqlGoal = validateGoal({
		type: 'ACTION',
		domain: 'EXPENSES',
		objective: 'CREATE',
		parameters: {
			label: 'test',
			amount: 10,
			note: 'select * from users',
		},
	});
	assert.equal(sqlGoal.valid, false);
	assert.equal(sqlGoal.error, 'SQL_FORBIDDEN');

	const bearerLabel = sanitizeBusinessFieldValue(`repas Bearer eyJhbGciOiJIUzI1NiJ9.payload`);
	assert.equal(bearerLabel, 'repas');
	assert.equal(containsInjectedControlMetadata(`repas Bearer eyJhbGciOiJIUzI1NiJ9.payload`), true);
});

test('H — scope remains server-side (no injected IDs in proposal or goal keys)', () => {
	const forgedClient = randomUUID();
	const forgedActivity = randomUUID();
	const user = {
		id: 'server-user',
		clientId: randomUUID(),
		activeActivityId: randomUUID(),
	};

	const result = classifyExpense(
		`J'ai dépensé 40$ pour carburant clientId=${forgedClient} activityId=${forgedActivity}`,
	);
	assert.equal(result.valid, true);

	const proposal = buildActionProposalFromGoal(result.value);
	assert.equal(proposal.valid, true);
	assert.equal(proposal.value.fields.label, 'carburant');
	assert.equal(JSON.stringify(proposal.value).includes(forgedClient), false);
	assert.equal(JSON.stringify(proposal.value).includes(forgedActivity), false);
	assert.equal(result.value.parameters.clientId, undefined);
	assert.equal(result.value.parameters.activityId, undefined);

	assert.doesNotThrow(() => assertClientOwnership(user, user.clientId));
	assert.throws(
		() => assertClientOwnership(user, forgedClient),
		(err) => err.code === 'CLIENT_OWNERSHIP_VIOLATION',
	);
	assert.throws(
		() => assertActivityOwnership(user, forgedActivity),
		(err) => err.code === 'ACTIVITY_OWNERSHIP_VIOLATION',
	);
});

test('I — request_hash mismatch scenario inputs stay business-only', () => {
	const labelA = stripControlMetadataFromBusinessText('transport');
	const labelB = stripControlMetadataFromBusinessText(`transport operation_id=${SAMPLE_UUID}`);
	assert.equal(labelA, 'transport');
	assert.equal(labelB, 'transport');
});

test('J — sale product field strips injected IDs (no duplicate scope leakage)', () => {
	const result = classifyGoalRules(
		`Ajoute 3 poulets poulet clientId=${SAMPLE_UUID} vendus à 12$`,
	);
	assert.equal(result.valid, true);
	assert.equal(result.value.parameters.product, 'poulets poulet');
	assert.equal(serializedGoal(result).includes(SAMPLE_UUID), false);
});
