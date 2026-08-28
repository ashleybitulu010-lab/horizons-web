import assert from 'node:assert/strict';
import test from 'node:test';

import {
	clearConversationState,
	createEmptyConversationState,
	getConversationState,
	saveConversationState,
	assertConversationStateIsContextOnly,
} from '../src/agent/conversation-state.js';
import {
	createInMemoryConversationStore,
	isExpired,
	resetConversationStoreForTests,
	setConversationStore,
} from '../src/agent/conversation-store.js';

test.beforeEach(() => {
	resetConversationStoreForTests();
});

test('conversation store exposes get/save/clear interface', () => {
	const store = createInMemoryConversationStore({ ttlMs: 60_000 });
	setConversationStore(store);

	const state = createEmptyConversationState();
	state.topic = 'sales';
	saveConversationState('user-1', 'sess-a', state);

	const loaded = getConversationState('user-1', 'sess-a');
	assert.equal(loaded.topic, 'sales');
	assert.deepEqual(loaded.references, state.references);

	clearConversationState('user-1', 'sess-a');
	assert.equal(getConversationState('user-1', 'sess-a').topic, null);
});

test('TTL expires entries after savedAt + ttlMs', () => {
	let currentTime = 1_000_000;
	const store = createInMemoryConversationStore({
		ttlMs: 2 * 60 * 60 * 1000,
		now: () => currentTime,
	});
	setConversationStore(store);

	const state = createEmptyConversationState();
	state.topic = 'sales';
	saveConversationState('user-1', 'sess-ttl', state);
	assert.equal(getConversationState('user-1', 'sess-ttl').topic, 'sales');

	currentTime += 2 * 60 * 60 * 1000 + 1;
	assert.equal(getConversationState('user-1', 'sess-ttl').topic, null);
});

test('isExpired uses savedAt semantics', () => {
	const savedAt = 1_000;
	assert.equal(isExpired(savedAt, 500, 1_400), false);
	assert.equal(isExpired(savedAt, 500, 1_501), true);
});

test('conversation state rejects financial keys', () => {
	const state = createEmptyConversationState();
	state.filters = { totalRevenue: 100 };
	assert.throws(
		() => assertConversationStateIsContextOnly(state),
		/must not store financial truth/,
	);
});

test('conversation state rejects unexpected keys', () => {
	const state = createEmptyConversationState();
	state.sales = [];
	assert.throws(
		() => assertConversationStateIsContextOnly(state),
		/Unexpected conversation state key: sales/,
	);
});
