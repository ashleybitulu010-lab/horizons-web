const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

function sessionKey(userId, sessionId) {
	return `${userId}:${sessionId || 'default'}`;
}

/**
 * In-memory conversation store (Phase 2.1).
 * Replaceable later by Supabase/Redis without changing the agent.
 */
export function createInMemoryConversationStore({ ttlMs = DEFAULT_TTL_MS } = {}) {
	const sessions = new Map();

	return {
		getConversationState(userId, sessionId) {
			const key = sessionKey(userId, sessionId);
			const existing = sessions.get(key);
			if (!existing) return null;
			if (Date.now() - existing.expiresAt > ttlMs) {
				sessions.delete(key);
				return null;
			}
			return structuredClone(existing.state);
		},

		saveConversationState(userId, sessionId, state) {
			const key = sessionKey(userId, sessionId);
			sessions.set(key, {
				state: structuredClone(state),
				expiresAt: Date.now(),
			});
		},

		clearConversationState(userId, sessionId) {
			sessions.delete(sessionKey(userId, sessionId));
		},

		clearAllForTests() {
			sessions.clear();
		},
	};
}

let activeStore = createInMemoryConversationStore();

export function getConversationStore() {
	return activeStore;
}

export function setConversationStore(store) {
	activeStore = store;
}

export function resetConversationStoreForTests() {
	activeStore = createInMemoryConversationStore();
}
