import {
	ALLOWED_STATE_KEYS,
	createEmptyConversationState,
} from '../agent/conversation-state.js';
import { getConversationStore } from '../agent/conversation-store.js';
import { getSessionsPair } from './agent-session-service.js';
import logger from '../utils/logger.js';

export const READ_SOURCES = Object.freeze({
	AGENT_SESSIONS: 'agent_sessions',
	CONVERSATION_STORE_FALLBACK: 'conversation_store_fallback',
	AGENT_SESSIONS_ERROR_FALLBACK: 'agent_sessions_error_fallback',
});

export const READ_MODES = Object.freeze({
	DB_PRIMARY: 'DB_PRIMARY',
	RAM_FALLBACK: 'RAM_FALLBACK',
	RAM_PENDING_MERGE: 'RAM_PENDING_MERGE',
	DB_PENDING_PRIMARY: 'DB_PENDING_PRIMARY',
	PENDING_DIVERGENCE: 'PENDING_DIVERGENCE',
});

const readMetrics = {
	dbHit: 0,
	fallbackHit: 0,
	errorFallbackHit: 0,
	dbPrimary: 0,
	ramFallback: 0,
	ramPendingMerge: 0,
	dbPendingPrimary: 0,
	pendingDivergence: 0,
};

let getAgentSessionStateImpl = null;

export function setGetAgentSessionStateImplForTests(impl) {
	getAgentSessionStateImpl = impl;
}

export function resetAgentSessionReaderForTests() {
	getAgentSessionStateImpl = null;
	readMetrics.dbHit = 0;
	readMetrics.fallbackHit = 0;
	readMetrics.errorFallbackHit = 0;
	readMetrics.dbPrimary = 0;
	readMetrics.ramFallback = 0;
	readMetrics.ramPendingMerge = 0;
	readMetrics.dbPendingPrimary = 0;
	readMetrics.pendingDivergence = 0;
}

export function getAgentSessionReadMetricsForTests() {
	return { ...readMetrics };
}

function mergePayloadIntoState(state, payload, { skipPendingWrite = false } = {}) {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return;
	}

	for (const key of ALLOWED_STATE_KEYS) {
		if (key === 'pendingWrite' && skipPendingWrite) continue;
		if (payload[key] === undefined) continue;

		if (key === 'filters') {
			state.filters = { ...state.filters, ...(payload.filters || {}) };
		} else if (key === 'references') {
			state.references = { ...state.references, ...(payload.references || {}) };
		} else {
			state[key] = payload[key];
		}
	}
}

/**
 * Map agent_sessions rows (draft + pending) into the Ashy conversation state shape.
 * DB columns `intention` and `awaiting` are merged from the pending row when present.
 */
export function mapSessionToAgentState(draftSession, pendingSession) {
	const state = createEmptyConversationState();

	if (draftSession?.payload) {
		mergePayloadIntoState(state, draftSession.payload);
	}

	if (pendingSession) {
		mergePayloadIntoState(state, pendingSession.payload, { skipPendingWrite: false });

		if (pendingSession.intention && state.intent == null) {
			state.intent = pendingSession.intention;
		}

		if (pendingSession.updatedAt) {
			state.updatedAt = pendingSession.updatedAt;
		}

		state.pendingSessionVersion = pendingSession.stateVersion ?? null;
		state.pendingConsumeToken = pendingSession.payload?.consumeToken ?? null;
		state.pendingOperationId = pendingSession.payload?.operationId ?? state.pendingOperationId ?? null;
	}

	if (draftSession?.updatedAt && !state.updatedAt) {
		state.updatedAt = draftSession.updatedAt;
	}

	return state;
}

function readLegacyConversationState(userId, sessionId, activityId = null) {
	const store = getConversationStore();
	const stored = store.getConversationState(userId, sessionId, activityId)
		|| (activityId ? store.getConversationState(userId, sessionId, null) : null);
	return stored || createEmptyConversationState();
}

function hasDbContent(draftSession, pendingSession) {
	return Boolean(draftSession || pendingSession);
}

function hasDbPending(pendingSession) {
	return Boolean(pendingSession?.payload?.pendingWrite);
}

function hasRamPending(ramState) {
	return ramState?.pendingWrite != null;
}

function extractDbPendingMeta(pendingSession) {
	return {
		updatedAt: pendingSession?.updatedAt ?? null,
		stateVersion: pendingSession?.stateVersion ?? null,
	};
}

function extractRamPendingMeta(ramState) {
	return {
		updatedAt: ramState?.updatedAt ?? null,
		stateVersion: ramState?.pendingSessionVersion ?? null,
	};
}

function parseTimestamp(value) {
	if (!value) return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Compare pending freshness using existing metadata only.
 * Returns 'db' | 'ram' | 'ambiguous' — ambiguous → conservative DB priority.
 */
export function comparePendingFreshness(dbMeta, ramMeta) {
	const dbVersion = dbMeta.stateVersion;
	const ramVersion = ramMeta.stateVersion;

	if (dbVersion != null && ramVersion != null) {
		if (dbVersion > ramVersion) return 'db';
		if (ramVersion > dbVersion) return 'ram';
	}

	if (dbVersion != null && ramVersion == null) return 'db';
	if (ramVersion != null && dbVersion == null) return 'ram';

	const dbTs = parseTimestamp(dbMeta.updatedAt);
	const ramTs = parseTimestamp(ramMeta.updatedAt);

	if (dbTs != null && ramTs != null) {
		if (dbTs > ramTs) return 'db';
		if (ramTs > dbTs) return 'ram';
		return 'ambiguous';
	}

	if (dbTs != null && ramTs == null) return 'db';
	if (ramTs != null && dbTs == null) return 'ram';

	return 'ambiguous';
}

function applyRamPendingFields(state, ramState) {
	state.pendingWrite = ramState.pendingWrite;
	state.pendingSessionVersion = ramState.pendingSessionVersion ?? null;
	state.pendingConsumeToken = ramState.pendingConsumeToken ?? null;
	state.pendingOperationId = ramState.pendingOperationId ?? state.pendingOperationId ?? null;

	if (ramState.intent != null && state.intent == null) {
		state.intent = ramState.intent;
	}
}

function pendingWriteToolLabel(pendingWrite) {
	if (!pendingWrite || typeof pendingWrite !== 'object') return null;
	return pendingWrite.tool ?? null;
}

function pendingWritesDiffer(dbState, ramState) {
	const dbTool = pendingWriteToolLabel(dbState.pendingWrite);
	const ramTool = pendingWriteToolLabel(ramState.pendingWrite);
	if (dbTool !== ramTool) return true;

	const dbVersion = dbState.pendingSessionVersion;
	const ramVersion = ramState.pendingSessionVersion;
	if (dbVersion != null && ramVersion != null && dbVersion !== ramVersion) {
		return true;
	}

	const dbToken = dbState.pendingConsumeToken;
	const ramToken = ramState.pendingConsumeToken;
	if (dbToken && ramToken && dbToken !== ramToken) {
		return true;
	}

	return false;
}

/**
 * Merge DB draft/pending with RAM pending during transition (read-only, in-memory).
 */
export function resolvePendingFromDbAndRam(dbState, pendingSession, ramState) {
	const dbHasPending = hasDbPending(pendingSession);
	const ramHasPending = hasRamPending(ramState);

	if (dbHasPending && !ramHasPending) {
		return {
			state: dbState,
			readMode: READ_MODES.DB_PENDING_PRIMARY,
			awaiting: pendingSession?.awaiting ?? null,
			pendingDivergence: false,
		};
	}

	if (!dbHasPending && ramHasPending) {
		const merged = structuredClone(dbState);
		applyRamPendingFields(merged, ramState);
		return {
			state: merged,
			readMode: READ_MODES.RAM_PENDING_MERGE,
			awaiting: 'confirm',
			pendingDivergence: false,
		};
	}

	if (dbHasPending && ramHasPending) {
		const winner = comparePendingFreshness(
			extractDbPendingMeta(pendingSession),
			extractRamPendingMeta(ramState),
		);
		const divergent = pendingWritesDiffer(dbState, ramState);

		if (winner === 'ram') {
			const merged = structuredClone(dbState);
			applyRamPendingFields(merged, ramState);
			return {
				state: merged,
				readMode: READ_MODES.RAM_PENDING_MERGE,
				awaiting: pendingSession?.awaiting ?? 'confirm',
				pendingDivergence: divergent,
			};
		}

		if (winner === 'ambiguous') {
			return {
				state: dbState,
				readMode: READ_MODES.PENDING_DIVERGENCE,
				awaiting: pendingSession?.awaiting ?? null,
				pendingDivergence: true,
			};
		}

		return {
			state: dbState,
			readMode: READ_MODES.DB_PENDING_PRIMARY,
			awaiting: pendingSession?.awaiting ?? null,
			pendingDivergence: divergent,
		};
	}

	return {
		state: dbState,
		readMode: READ_MODES.DB_PRIMARY,
		awaiting: pendingSession?.awaiting ?? null,
		pendingDivergence: false,
	};
}

function logReadSource(source, userId, sessionId, extras = {}) {
	logger.warn('[agent-session-reader]', {
		source,
		userId,
		sessionId,
		...extras,
	});
}

function recordReadMetrics(readMode, pendingDivergence) {
	readMetrics.dbHit += 1;
	readMetrics.dbPrimary += 1;

	switch (readMode) {
		case READ_MODES.RAM_PENDING_MERGE:
			readMetrics.ramPendingMerge += 1;
			break;
		case READ_MODES.DB_PENDING_PRIMARY:
			readMetrics.dbPendingPrimary += 1;
			break;
		case READ_MODES.PENDING_DIVERGENCE:
			readMetrics.pendingDivergence += 1;
			readMetrics.dbPendingPrimary += 1;
			break;
		default:
			break;
	}

	if (pendingDivergence && readMode !== READ_MODES.PENDING_DIVERGENCE) {
		readMetrics.pendingDivergence += 1;
	}
}

async function loadDbSessions(user) {
	return getSessionsPair({ user });
}

/**
 * Read Ashy conversation state: agent_sessions PRIMARY, conversation-store FALLBACK.
 * Never writes to DB or RAM — read-only.
 */
export async function getAgentSessionState({ user, sessionId = 'default' }) {
	if (getAgentSessionStateImpl) {
		return getAgentSessionStateImpl({ user, sessionId });
	}

	if (!user?.id) {
		readMetrics.ramFallback += 1;
		return {
			state: createEmptyConversationState(),
			source: READ_SOURCES.CONVERSATION_STORE_FALLBACK,
			readMode: READ_MODES.RAM_FALLBACK,
			awaiting: null,
		};
	}

	try {
		const { draft, pending } = await loadDbSessions(user);

		if (hasDbContent(draft, pending)) {
			const dbState = mapSessionToAgentState(draft, pending);
			const ramState = readLegacyConversationState(user.id, sessionId, user.activeActivityId);
			const resolved = resolvePendingFromDbAndRam(dbState, pending, ramState);

			recordReadMetrics(resolved.readMode, resolved.pendingDivergence);
			logReadSource(READ_SOURCES.AGENT_SESSIONS, user.id, sessionId, {
				readMode: resolved.readMode,
				hasDbDraft: Boolean(draft),
				hasDbPending: hasDbPending(pending),
				hasRamPending: hasRamPending(ramState),
				pendingDivergence: resolved.pendingDivergence,
			});

			return {
				state: resolved.state,
				source: READ_SOURCES.AGENT_SESSIONS,
				readMode: resolved.readMode,
				awaiting: resolved.awaiting,
			};
		}
	} catch (error) {
		readMetrics.errorFallbackHit += 1;
		readMetrics.ramFallback += 1;
		logReadSource(
			READ_SOURCES.AGENT_SESSIONS_ERROR_FALLBACK,
			user.id,
			sessionId,
			{
				readMode: READ_MODES.RAM_FALLBACK,
				errorCode: error?.code || 'UNKNOWN',
			},
		);
		return {
			state: readLegacyConversationState(user.id, sessionId, user.activeActivityId),
			source: READ_SOURCES.AGENT_SESSIONS_ERROR_FALLBACK,
			readMode: READ_MODES.RAM_FALLBACK,
			awaiting: null,
		};
	}

	readMetrics.fallbackHit += 1;
	readMetrics.ramFallback += 1;
	logReadSource(READ_SOURCES.CONVERSATION_STORE_FALLBACK, user.id, sessionId, {
		readMode: READ_MODES.RAM_FALLBACK,
	});
	return {
		state: readLegacyConversationState(user.id, sessionId, user.activeActivityId),
		source: READ_SOURCES.CONVERSATION_STORE_FALLBACK,
		readMode: READ_MODES.RAM_FALLBACK,
		awaiting: null,
	};
}
