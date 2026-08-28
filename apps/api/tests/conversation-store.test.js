import assert from 'node:assert/strict';
import test from 'node:test';

import {
	clearConversationState,
	createEmptyConversationState,
	getConversationState,
	saveConversationState,
} from '../src/agent/conversation-state.js';
import {
	createInMemoryConversationStore,
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
