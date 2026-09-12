/**
 * P1-E — activity reference resolution (server-side, tenant-scoped).
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
	buildAmbiguousClarification,
	resetActivityReferenceResolverForTests,
	resolveActivityReference,
	setListActivitiesForClientImplForTests,
} from '../src/services/activity-reference-resolver.js';
import {
	resetActivityScopeImplForTests,
	setValidateActivityForClientImplForTests,
} from '../src/services/activity-scope.js';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const ACT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FOREIGN = '99999999-9999-4999-8999-999999999999';

const ACTIVITIES = [
	{ id: ACT_A, clientId: CLIENT, name: 'Ketura Boutique', type: 'commerce', isDefault: true },
	{ id: ACT_B, clientId: CLIENT, name: 'Ketura Production', type: 'production', isDefault: false },
];

afterEach(() => {
	resetActivityReferenceResolverForTests();
	resetActivityScopeImplForTests();
});

describe('P1-E activity reference resolver', () => {
	test('empty reference → DEFAULT', async () => {
		const result = await resolveActivityReference(CLIENT, '');
		assert.equal(result.status, 'DEFAULT');
	});

	test('exact name → RESOLVED', async () => {
		setListActivitiesForClientImplForTests(async () => ACTIVITIES);
		const result = await resolveActivityReference(CLIENT, 'Ketura Boutique');
		assert.equal(result.status, 'RESOLVED');
		assert.equal(result.activity.id, ACT_A);
	});

	test('partial shared prefix → AMBIGUOUS', async () => {
		setListActivitiesForClientImplForTests(async () => ACTIVITIES);
		const result = await resolveActivityReference(CLIENT, 'Ketura');
		assert.equal(result.status, 'AMBIGUOUS');
		assert.equal(result.matches.length, 2);
		assert.match(result.clarificationQuestion, /Ketura Boutique/);
	});

	test('foreign tenant activity name → NOT_FOUND', async () => {
		setListActivitiesForClientImplForTests(async () => ACTIVITIES);
		const result = await resolveActivityReference(CLIENT, 'Sinergy');
		assert.equal(result.status, 'NOT_FOUND');
	});

	test('foreign activity UUID → NOT_FOUND', async () => {
		setValidateActivityForClientImplForTests(async () => {
			throw Object.assign(new Error('Activity does not belong to client'), {
				code: 'ACTIVITY_OWNERSHIP_VIOLATION',
			});
		});
		const result = await resolveActivityReference(CLIENT, FOREIGN);
		assert.equal(result.status, 'NOT_FOUND');
	});

	test('buildAmbiguousClarification formats two names', () => {
		const text = buildAmbiguousClarification([
			{ name: 'Ketura Boutique' },
			{ name: 'Ketura Production' },
		]);
		assert.match(text, /Ketura Boutique/);
		assert.match(text, /Ketura Production/);
	});
});
