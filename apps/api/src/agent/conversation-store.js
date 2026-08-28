export const DEFAULT_CONVERSATION_TTL_MS = 2 * 60 * 60 * 1000;

function sessionKey(userId, sessionId) {
	return `${userId}:${sessionId || 'default'}`;
}

function isExpired(savedAt, ttlMs, now = Date.now()) {
	return now - savedAt > ttlMs;
}

/**
 * In-memory conversation store (Phase 2.1).
 * Replaceable later by Supabase/Redis without changing the agent.
 *
 * TTL semantics: each entry stores `savedAt` (last write time).
 * A session expires when `now - savedAt > ttlMs` (default 2 hours).
 */
export function createInMemoryConversationStore({
	ttlMs = DEFAULT_CONVERSATION_TTL_MS,
	now = () => Date.now(),
} = {}) {
	const sessions = new Map();

	return {
		getConversationState(userId, sessionId) {
			const key = sessionKey(userId, sessionId);
			const existing = sessions.get(key);
			if (!existing) return null;
			if (isExpired(existing.savedAt, ttlMs, now())) {
				sessions.delete(key);
				return null;
			}
			return structuredClone(existing.state);
		},

		saveConversationState(userId, sessionId, state) {
			const key = sessionKey(userId, sessionId);
			sessions.set(key, {
				state: structuredClone(state),
				savedAt: now(),
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

export { isExpired };
