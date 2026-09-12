/**
 * P1-E — conversation RAM isolation + intent reconciliation (unit).
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
	clearConversationState,
	createEmptyConversationState,
	getConversationState,
	saveConversationState,
} from '../src/agent/conversation-state.js';
import { sessionKey } from '../src/agent/conversation-store.js';
import { reconcileMisclassifiedReadIntent } from '../src/agent/intent-resolver/index.js';
import { resolveIntentRegex } from '../src/agent/intent-resolver/regex-resolver.js';

const USER = 'user-p1e';
const SESSION = 'sess-1';
const ACT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

afterEach(() => {
	clearConversationState(USER, SESSION, ACT_A);
	clearConversationState(USER, SESSION, ACT_B);
	clearConversationState(USER, SESSION, null);
});

describe('P1-E RAM session isolation', () => {
	test('session keys differ by activity', () => {
		assert.notEqual(
			sessionKey(USER, SESSION, ACT_A),
			sessionKey(USER, SESSION, ACT_B),
		);
	});

	test('pending state in activity A is invisible from activity B', () => {
		const stateA = createEmptyConversationState();
		stateA.pendingWrite = { tool: 'create_expense', label: 'transport', amount: 500 };
		saveConversationState(USER, SESSION, stateA, ACT_A);

		const stateB = getConversationState(USER, SESSION, ACT_B);
		assert.equal(stateB.pendingWrite, null);
		assert.equal(getConversationState(USER, SESSION, ACT_A).pendingWrite?.label, 'transport');
	});
});

describe('P1-E intent read reconciliation', () => {
	test('LLM create_expense misclassification corrected for product query', () => {
		const message = 'Quels sont mes produits ?';
		const regex = resolveIntentRegex(message, {});
		assert.equal(regex.intent, 'query_products');

		const reconciled = reconcileMisclassifiedReadIntent(message, {
			intent: 'create_expense',
			topic: 'expenses',
			filters: { label: message, amount: 1 },
			references: {},
			needsTool: true,
			needsClarification: false,
			resolver: 'llm',
		}, {});

		assert.equal(reconciled.intent, 'query_products');
		assert.equal(reconciled.resolverMeta?.reconciledFrom, 'create_expense');
	});
});
