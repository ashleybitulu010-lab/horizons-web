/**
 * P1-D — activity scope backend (unit + optional integration).
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { rejectForeignScope } from '../src/middleware/auth.js';
import { resolveActivityScope } from '../src/middleware/activity-scope.js';
import {
	resetActivityScopeImplForTests,
	setResolveDefaultActivityImplForTests,
	setValidateActivityForClientImplForTests,
} from '../src/services/activity-scope.js';
import {
	getBusinessScope,
	requireActivityScope,
	assertActivityOwnership,
} from '../src/services/supabase-scoped.js';
import { assertNoIdentityParams } from '../src/tools/validation.js';

const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const CLIENT_B = '22222222-2222-4222-8222-222222222222';
const ACTIVITY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const ACTIVITY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
const ACTIVITY_OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const USER_A = {
	id: 'pb-a',
	clientId: CLIENT_A,
	activeActivityId: ACTIVITY_A,
};

describe('P1-D unit — business scope helpers', () => {
	test('getBusinessScope requires client + activity', () => {
		const scope = getBusinessScope(USER_A);
		assert.equal(scope.clientId, CLIENT_A);
		assert.equal(scope.activityId, ACTIVITY_A);
	});

	test('requireActivityScope rejects missing activity', () => {
		assert.throws(
			() => requireActivityScope({ clientId: CLIENT_A }),
			(err) => err?.code === 'SUPABASE_ACTIVITY_SCOPE_MISSING',
		);
	});

	test('assertActivityOwnership rejects foreign activity', () => {
		assert.throws(
			() => assertActivityOwnership(USER_A, ACTIVITY_B),
			(err) => err?.code === 'ACTIVITY_OWNERSHIP_VIOLATION',
		);
	});

	test('tools forbid activityId from model input', () => {
		assert.throws(
			() => assertNoIdentityParams({ activityId: ACTIVITY_B }, 'get_sales'),
			(err) => err?.code === 'FORBIDDEN_PARAMETER',
		);
	});
});

describe('P1-D unit — resolveActivityScope middleware', () => {
	beforeEach(() => {
		setResolveDefaultActivityImplForTests(async (clientId) => {
			if (clientId === CLIENT_A) {
				return { id: ACTIVITY_A, clientId, name: 'Default A', type: 'commerce', isDefault: true };
			}
			return { id: ACTIVITY_B, clientId, name: 'Default B', type: 'commerce', isDefault: true };
		});
		setValidateActivityForClientImplForTests(async (clientId, activityId) => {
			if (clientId === CLIENT_A && activityId === ACTIVITY_A) {
				return { id: ACTIVITY_A, clientId, name: 'Activity A', type: 'commerce', isDefault: true };
			}
			if (clientId === CLIENT_B && activityId === ACTIVITY_B) {
				return { id: ACTIVITY_B, clientId, name: 'Activity B', type: 'commerce', isDefault: true };
			}
			const error = new Error('Activity does not belong to client');
			error.code = 'ACTIVITY_OWNERSHIP_VIOLATION';
			throw error;
		});
	});

	test('Test A — explicit activity A for client A → allowed', async () => {
		const req = { user: { clientId: CLIENT_A }, get: () => ACTIVITY_A, body: {}, query: {} };
		let nextCalled = false;
		await resolveActivityScope(req, {}, () => { nextCalled = true; });
		assert.equal(nextCalled, true);
		assert.equal(req.user.activeActivityId, ACTIVITY_A);
	});

	test('Test B — client A + foreign activity → forbidden via validate', async () => {
		const req = { user: { clientId: CLIENT_A }, get: () => ACTIVITY_B, body: {}, query: {} };
		const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(v) { this.body = v; } };
		await resolveActivityScope(req, res, () => {});
		assert.equal(res.statusCode, 403);
	});

	test('Test C — forged client_id in body → 403 via rejectForeignScope', async () => {
		const req = {
			user: { clientId: CLIENT_A, activeActivityId: ACTIVITY_A },
			body: { client_id: CLIENT_B },
			query: {},
		};
		const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(v) { this.body = v; } };
		rejectForeignScope(req, res, () => assert.fail('should not next'));
		assert.equal(res.statusCode, 403);
	});

	test('Test D — forged activity_id in body → 403', async () => {
		const req = {
			user: { clientId: CLIENT_A, activeActivityId: ACTIVITY_A },
			body: { activity_id: ACTIVITY_OTHER },
			query: {},
		};
		const res = { statusCode: null, status(code) { this.statusCode = code; return this; }, json() {} };
		rejectForeignScope(req, res, () => assert.fail('should not next'));
		assert.equal(res.statusCode, 403);
	});

	test('Test 7 — no activity header → default activity resolved', async () => {
		const req = { user: { clientId: CLIENT_A }, get: () => null, body: {}, query: {} };
		let nextCalled = false;
		await resolveActivityScope(req, {}, () => { nextCalled = true; });
		assert.equal(nextCalled, true);
		assert.equal(req.user.activeActivityId, ACTIVITY_A);
	});

	afterEach(() => {
		resetActivityScopeImplForTests();
	});
});
