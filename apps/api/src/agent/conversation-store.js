export const DEFAULT_CONVERSATION_TTL_MS = 2 * 60 * 60 * 1000;

function sessionKey(userId, sessionId, activityId = null) {
	const activitySegment = activityId || '_legacy';
	return `${userId}:${activitySegment}:${sessionId || 'default'}`;
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
 * P1-E: RAM key is userId:activityId:sessionId.
 */
export function createInMemoryConversationStore({
	ttlMs = DEFAULT_CONVERSATION_TTL_MS,
	now = () => Date.now(),
} = {}) {
	const sessions = new Map();

	return {
		getConversationState(userId, sessionId, activityId = null) {
			const key = sessionKey(userId, sessionId, activityId);
			const existing = sessions.get(key);
			if (!existing) return null;
			if (isExpired(existing.savedAt, ttlMs, now())) {
				sessions.delete(key);
				return null;
			}
			return structuredClone(existing.state);
		},

		saveConversationState(userId, sessionId, state, activityId = null) {
			const key = sessionKey(userId, sessionId, activityId);
			sessions.set(key, {
				state: structuredClone(state),
				savedAt: now(),
			});
		},

		clearConversationState(userId, sessionId, activityId = null) {
			sessions.delete(sessionKey(userId, sessionId, activityId));
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

export { isExpired, sessionKey };
