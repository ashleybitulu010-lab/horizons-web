import { createEmptyConversationState, getConversationState } from '../agent/conversation-state.js';
import { mapSessionToAgentState } from './agent-session-reader.js';
import { getSessionsPair } from './agent-session-service.js';
import { isSupabaseConfigured } from '../config/env.js';
import { requireClientScope } from './supabase-scoped.js';
import logger from '../utils/logger.js';

export const DIVERGENCE_TYPES = Object.freeze({
	DB_MISSING: 'DB_MISSING',
	RAM_MISSING: 'RAM_MISSING',
	TOPIC_MISMATCH: 'TOPIC_MISMATCH',
	INTENT_MISMATCH: 'INTENT_MISMATCH',
	FILTERS_MISMATCH: 'FILTERS_MISMATCH',
	REFERENCES_MISMATCH: 'REFERENCES_MISMATCH',
	LAST_TOOL_MISMATCH: 'LAST_TOOL_MISMATCH',
	LAST_ACTION_MISMATCH: 'LAST_ACTION_MISMATCH',
	PENDING_MISMATCH: 'PENDING_MISMATCH',
	PENDING_DB_ONLY: 'PENDING_DB_ONLY',
	PENDING_RAM_ONLY: 'PENDING_RAM_ONLY',
	UPDATED_AT_ONLY: 'UPDATED_AT_ONLY',
});

export const SEVERITY = Object.freeze({
	BENIGN: 'BENIGN',
	TRANSIENT: 'TRANSIENT',
	WARNING: 'WARNING',
	CRITICAL: 'CRITICAL',
});

const COMPARABLE_KEYS = Object.freeze([
	'topic',
	'intent',
	'filters',
	'references',
	'lastTool',
	'lastAction',
	'pendingWrite',
]);

const parityMetrics = {
	parity_check: 0,
	parity_match: 0,
	parity_divergence: 0,
	parity_skipped: 0,
	parity_error: 0,
};

let observeImpl = null;
let isParityEnabledOverride = null;
let loadDbSessionsImpl = null;

export function setObserveAgentSessionParityImplForTests(impl) {
	observeImpl = impl;
}

export function setIsParityEnabledForTests(value) {
	isParityEnabledOverride = value;
}

export function setLoadDbSessionsForParityTests(impl) {
	loadDbSessionsImpl = impl;
}

export function resetAgentSessionParityForTests() {
	observeImpl = null;
	isParityEnabledOverride = null;
	loadDbSessionsImpl = null;
	parityMetrics.parity_check = 0;
	parityMetrics.parity_match = 0;
	parityMetrics.parity_divergence = 0;
	parityMetrics.parity_skipped = 0;
	parityMetrics.parity_error = 0;
}

export function getAgentSessionParityMetricsForTests() {
	return { ...parityMetrics };
}

export function isAgentSessionParityEnabled() {
	if (isParityEnabledOverride !== null) {
		return isParityEnabledOverride;
	}
	if (process.env.AGENT_SESSION_PARITY_ENABLED === 'false') {
		return false;
	}
	if (process.env.AGENT_SESSION_PARITY_ENABLED === 'true') {
		return true;
	}
	return process.env.NODE_ENV !== 'production';
}

function emptyReferences() {
	return {
		lastPeriod: null,
		previousPeriod: null,
		lastProduct: null,
		lastEntity: null,
	};
}

function sortKeysDeep(value) {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) {
		return value;
	}
	return Object.keys(value).sort().reduce((acc, key) => {
		acc[key] = sortKeysDeep(value[key]);
		return acc;
	}, {});
}

function normalizePendingWrite(pendingWrite) {
	if (pendingWrite == null) return null;
	if (typeof pendingWrite !== 'object') return null;
	return sortKeysDeep(pendingWrite);
}

/**
 * Canonical comparable view of a ConversationState (updatedAt kept separately).
 */
export function normalizeConversationState(state) {
	const base = state && typeof state === 'object' ? state : createEmptyConversationState();

	return {
		topic: base.topic ?? null,
		intent: base.intent ?? null,
		filters: sortKeysDeep(base.filters ?? {}),
		references: sortKeysDeep(base.references ?? emptyReferences()),
		lastTool: base.lastTool ?? null,
		lastAction: base.lastAction ?? null,
		pendingWrite: normalizePendingWrite(base.pendingWrite),
		updatedAt: base.updatedAt ?? null,
	};
}

/**
 * Reconstruct DB rows into a comparable ConversationState shape.
 */
export function normalizeAgentSessions(draftSession, pendingSession) {
	const reconstructed = mapSessionToAgentState(draftSession, pendingSession);
	return normalizeConversationState(reconstructed);
}

function isEmptyNormalized(normalized) {
	return COMPARABLE_KEYS.every((key) => {
		if (key === 'filters') return Object.keys(normalized.filters).length === 0;
		if (key === 'references') {
			return Object.values(normalized.references).every((v) => v == null);
		}
		if (key === 'pendingWrite') return normalized.pendingWrite == null;
		return normalized[key] == null;
	});
}

function isDbEmpty(draftSession, pendingSession) {
	return !draftSession && !pendingSession;
}

function deepEqual(a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}

function classifySeverity(types, mirrorOutcome) {
	if (types.length === 0) return null;
	if (types.length === 1 && types[0] === DIVERGENCE_TYPES.UPDATED_AT_ONLY) {
		return SEVERITY.BENIGN;
	}
	if (types.some((t) => [
		DIVERGENCE_TYPES.PENDING_MISMATCH,
		DIVERGENCE_TYPES.PENDING_DB_ONLY,
		DIVERGENCE_TYPES.PENDING_RAM_ONLY,
	].includes(t))) {
		return SEVERITY.CRITICAL;
	}
	if (types.includes(DIVERGENCE_TYPES.DB_MISSING) && mirrorOutcome !== 'success') {
		return SEVERITY.TRANSIENT;
	}
	if (types.includes(DIVERGENCE_TYPES.DB_MISSING) && mirrorOutcome === 'success') {
		return SEVERITY.WARNING;
	}
	if (types.some((t) => [
		DIVERGENCE_TYPES.TOPIC_MISMATCH,
		DIVERGENCE_TYPES.INTENT_MISMATCH,
		DIVERGENCE_TYPES.FILTERS_MISMATCH,
		DIVERGENCE_TYPES.REFERENCES_MISMATCH,
	].includes(t))) {
		return SEVERITY.WARNING;
	}
	if (types.includes(DIVERGENCE_TYPES.RAM_MISSING)) {
		return SEVERITY.TRANSIENT;
	}
	return SEVERITY.WARNING;
}

/**
 * Compare normalized RAM vs DB conversation states.
 * Observe-only — never mutates RAM or DB.
 */
export function compareAgentSessionParity({
	ramState,
	draftSession = null,
	pendingSession = null,
	mirrorOutcome = 'success',
}) {
	const ramNorm = normalizeConversationState(ramState);
	const dbNorm = normalizeAgentSessions(draftSession, pendingSession);
	const divergenceTypes = [];

	const ramEmpty = isEmptyNormalized(ramNorm);
	const dbEmpty = isDbEmpty(draftSession, pendingSession);

	if (ramEmpty && dbEmpty) {
		return {
			match: true,
			divergenceTypes: [],
			severity: null,
			ramNorm,
			dbNorm,
		};
	}

	if (!ramEmpty && dbEmpty) {
		divergenceTypes.push(DIVERGENCE_TYPES.DB_MISSING);
	}

	if (ramEmpty && !dbEmpty) {
		divergenceTypes.push(DIVERGENCE_TYPES.RAM_MISSING);
	}

	const ramHasPending = ramNorm.pendingWrite != null;
	const dbHasPending = pendingSession != null && pendingSession.payload?.pendingWrite != null;

	if (ramHasPending && !dbHasPending) {
		divergenceTypes.push(DIVERGENCE_TYPES.PENDING_RAM_ONLY);
	} else if (!ramHasPending && dbHasPending) {
		divergenceTypes.push(DIVERGENCE_TYPES.PENDING_DB_ONLY);
	} else if (ramHasPending && dbHasPending && !deepEqual(ramNorm.pendingWrite, dbNorm.pendingWrite)) {
		divergenceTypes.push(DIVERGENCE_TYPES.PENDING_MISMATCH);
	}

	if (ramNorm.topic !== dbNorm.topic) divergenceTypes.push(DIVERGENCE_TYPES.TOPIC_MISMATCH);
	if (ramNorm.intent !== dbNorm.intent) divergenceTypes.push(DIVERGENCE_TYPES.INTENT_MISMATCH);
	if (ramNorm.lastTool !== dbNorm.lastTool) divergenceTypes.push(DIVERGENCE_TYPES.LAST_TOOL_MISMATCH);
	if (ramNorm.lastAction !== dbNorm.lastAction) divergenceTypes.push(DIVERGENCE_TYPES.LAST_ACTION_MISMATCH);
	if (!deepEqual(ramNorm.filters, dbNorm.filters)) divergenceTypes.push(DIVERGENCE_TYPES.FILTERS_MISMATCH);
	if (!deepEqual(ramNorm.references, dbNorm.references)) {
		divergenceTypes.push(DIVERGENCE_TYPES.REFERENCES_MISMATCH);
	}

	const contentTypes = [...new Set(divergenceTypes)];
	const contentMatch = contentTypes.length === 0;
	const updatedAtDiffers = ramNorm.updatedAt !== dbNorm.updatedAt;
	const allTypes = [...contentTypes];
	if (contentMatch && updatedAtDiffers) {
		allTypes.push(DIVERGENCE_TYPES.UPDATED_AT_ONLY);
	}

	return {
		match: contentMatch,
		divergenceTypes: allTypes,
		severity: contentMatch
			? (updatedAtDiffers ? SEVERITY.BENIGN : null)
			: classifySeverity(contentTypes, mirrorOutcome),
		ramNorm,
		dbNorm,
		updatedAtOnly: contentMatch && updatedAtDiffers,
	};
}

function logParity(meta) {
	logger.warn('[agent-session-parity]', {
		event: 'agent_session_parity',
		...meta,
	});
}

async function defaultLoadDbSessions(user) {
	return getSessionsPair({ user });
}

/**
 * Observe RAM vs DB parity after a mirror attempt. Never throws — FAIL_OPEN.
 */
export async function observeAgentSessionParity({
	user,
	sessionId,
	mirrorOutcome = 'success',
	ramState = null,
}) {
	if (observeImpl) {
		return observeImpl({ user, sessionId, mirrorOutcome, ramState });
	}

	if (!isAgentSessionParityEnabled()) {
		parityMetrics.parity_skipped += 1;
		return { outcome: 'skipped', reason: 'DISABLED' };
	}

	parityMetrics.parity_check += 1;

	let clientId = null;
	try {
		// Tests inject loadDbSessionsImpl — skip real Supabase gate in that case.
		if (!loadDbSessionsImpl && !isSupabaseConfigured()) {
			parityMetrics.parity_skipped += 1;
			logParity({
				outcome: 'skipped',
				userId: user?.id,
				sessionId,
				hasPendingWrite: ramState?.pendingWrite != null,
				errorCode: 'SUPABASE_UNAVAILABLE',
			});
			return { outcome: 'skipped', reason: 'SUPABASE_UNAVAILABLE' };
		}

		clientId = requireClientScope(user);
		const ram = getConversationState(user.id, sessionId);
		const loader = loadDbSessionsImpl || defaultLoadDbSessions;
		const { draft, pending } = await loader(user);

		const result = compareAgentSessionParity({
			ramState: ram,
			draftSession: draft,
			pendingSession: pending,
			mirrorOutcome,
		});

		const stateType = pending ? 'both' : (draft ? 'draft' : 'none');
		const hasPendingWrite = ram?.pendingWrite != null;

		if (result.match) {
			parityMetrics.parity_match += 1;
			logParity({
				outcome: 'match',
				userId: user.id,
				clientId,
				sessionId,
				stateType,
				hasPendingWrite,
				severity: result.severity,
				mirrorOutcome,
			});
		} else {
			parityMetrics.parity_divergence += 1;
			logParity({
				outcome: 'divergence',
				userId: user.id,
				clientId,
				sessionId,
				stateType,
				hasPendingWrite,
				divergenceTypes: result.divergenceTypes,
				severity: result.severity,
				mirrorOutcome,
			});
		}

		return { outcome: result.match ? 'match' : 'divergence', ...result };
	} catch (error) {
		parityMetrics.parity_error += 1;
		logParity({
			outcome: 'error',
			userId: user?.id,
			clientId,
			sessionId,
			hasPendingWrite: ramState?.pendingWrite != null,
			errorCode: error?.code || 'PARITY_ERROR',
			mirrorOutcome,
		});
		return { outcome: 'error', errorCode: error?.code || 'PARITY_ERROR' };
	}
}

/**
 * Schedule parity observation after mirror — non-blocking, observe-only.
 */
export function scheduleAgentSessionParityObservation({
	user,
	sessionId,
	mirrorOutcome,
	ramState,
}) {
	if (!isAgentSessionParityEnabled()) {
		return;
	}

	observeAgentSessionParity({ user, sessionId, mirrorOutcome, ramState }).catch(() => {
		parityMetrics.parity_error += 1;
	});
}
