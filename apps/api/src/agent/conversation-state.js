const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;
const sessions = new Map();

function sessionKey(userId, sessionId) {
	return `${userId}:${sessionId || 'default'}`;
}

export function createEmptyConversationState() {
	return {
		topic: null,
		intent: null,
		filters: {},
		lastTool: null,
		updatedAt: null,
	};
}

export function getConversationState(userId, sessionId) {
	const key = sessionKey(userId, sessionId);
	const existing = sessions.get(key);
	if (!existing) return createEmptyConversationState();
	if (Date.now() - existing.updatedAt > DEFAULT_TTL_MS) {
		sessions.delete(key);
		return createEmptyConversationState();
	}
	return { ...existing.state };
}

export function saveConversationState(userId, sessionId, state) {
	const key = sessionKey(userId, sessionId);
	sessions.set(key, {
		state: {
			...state,
			updatedAt: new Date().toISOString(),
		},
		updatedAt: Date.now(),
	});
}

export function clearConversationSessionsForTests() {
	sessions.clear();
}

export function mergeConversationState(current, patch) {
	return {
		...current,
		...patch,
		filters: {
			...current.filters,
			...(patch.filters || {}),
		},
		updatedAt: new Date().toISOString(),
	};
}
