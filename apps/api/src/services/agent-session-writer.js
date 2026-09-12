import { isSupabaseConfigured } from '../config/env.js';
import { requireClientScope } from './supabase-scoped.js';
import {
	mirrorSessionsAtomic,
	createPendingConsumeToken,
	getSessionsPair,
} from './agent-session-service.js';
import { scheduleAgentSessionParityObservation } from './agent-session-parity.js';
import logger from '../utils/logger.js';

export const MIRROR_OUTCOMES = Object.freeze({
	SUCCESS: 'success',
	FAILURE: 'failure',
	SKIPPED: 'skipped',
});

export const PENDING_PERSISTENCE_OUTCOMES = Object.freeze({
	SUCCESS: 'success',
	FAILED: 'failed',
	BLOCKED_CONFIRMATION: 'blockedConfirmation',
});

export const WRITE_OUTCOMES = Object.freeze({
	SUCCESS: 'SUCCESS',
	DB_FAILURE: 'DB_FAILURE',
	DB_DIVERGENCE: 'DB_DIVERGENCE',
	BLOCKED_CONFIRMATION: 'BLOCKED_CONFIRMATION',
	RAM_FALLBACK: 'RAM_FALLBACK',
});

export const WRITE_CATEGORIES = Object.freeze({
	PENDING: 'pending',
	DRAFT_CONTEXT: 'draft_context',
	PENDING_CLEAR: 'pending_clear',
	POST_TOOL: 'post_tool',
});

const DRAFT_PAYLOAD_KEYS = Object.freeze([
	'topic',
	'intent',
	'filters',
	'references',
	'lastTool',
	'lastAction',
	'updatedAt',
]);

const writeMetrics = {
	write_ram_success: 0,
	write_db_success: 0,
	write_db_failure: 0,
	write_db_skipped: 0,
	pending_cleared: 0,
	pending_persistence_success: 0,
	pending_persistence_failed: 0,
	pending_persistence_blocked_confirmation: 0,
	writer_db_primary: 0,
	writer_db_success: 0,
	writer_db_failure: 0,
	writer_ram_cache_success: 0,
	writer_ram_cache_failure: 0,
	writer_db_primary_fallback: 0,
};

let mirrorImpl = null;
let isSupabaseConfiguredOverride = null;
let isPendingDbRequiredOverride = null;
let isWriteDbFirstOverride = null;
let isRamFallbackOverride = null;

export function setIsSupabaseConfiguredForTests(value) {
	isSupabaseConfiguredOverride = value;
}

export function setIsPendingDbRequiredForTests(value) {
	isPendingDbRequiredOverride = value;
}

export function setIsWriteDbFirstForTests(value) {
	isWriteDbFirstOverride = value;
}

export function setIsRamFallbackEnabledForTests(value) {
	isRamFallbackOverride = value;
}

function checkSupabaseConfigured() {
	if (isSupabaseConfiguredOverride !== null) {
		return isSupabaseConfiguredOverride;
	}
	return isSupabaseConfigured();
}

export function setMirrorAgentSessionStateImplForTests(impl) {
	mirrorImpl = impl;
}

export function resetAgentSessionWriterForTests() {
	mirrorImpl = null;
	isSupabaseConfiguredOverride = null;
	isPendingDbRequiredOverride = null;
	isWriteDbFirstOverride = null;
	isRamFallbackOverride = null;
	writeMetrics.write_ram_success = 0;
	writeMetrics.write_db_success = 0;
	writeMetrics.write_db_failure = 0;
	writeMetrics.write_db_skipped = 0;
	writeMetrics.pending_cleared = 0;
	writeMetrics.pending_persistence_success = 0;
	writeMetrics.pending_persistence_failed = 0;
	writeMetrics.pending_persistence_blocked_confirmation = 0;
	writeMetrics.writer_db_primary = 0;
	writeMetrics.writer_db_success = 0;
	writeMetrics.writer_db_failure = 0;
	writeMetrics.writer_ram_cache_success = 0;
	writeMetrics.writer_ram_cache_failure = 0;
	writeMetrics.writer_db_primary_fallback = 0;
}

export function getAgentSessionWriteMetricsForTests() {
	return { ...writeMetrics };
}

export function incrementWriteRamSuccessForTests() {
	writeMetrics.write_ram_success += 1;
}

export function isPendingDbRequired() {
	if (isPendingDbRequiredOverride !== null) {
		return isPendingDbRequiredOverride;
	}
	return process.env.AGENT_SESSION_PENDING_DB_REQUIRED === 'true';
}

/**
 * DB-first writer (F3). Default false — legacy RAM-first path preserved.
 * AGENT_SESSION_MIRROR_AWAIT only affects legacy path (await async mirror).
 * AGENT_SESSION_PENDING_DB_REQUIRED gates NEEDS_CONFIRMATION (F2).
 * When WRITE_DB_FIRST=true without PENDING_DB_REQUIRED, pending stays fail-closed.
 */
export function isWriteDbFirst() {
	if (isWriteDbFirstOverride !== null) {
		return isWriteDbFirstOverride;
	}
	return process.env.AGENT_SESSION_WRITE_DB_FIRST === 'true';
}

export function isRamFallbackEnabled() {
	if (isRamFallbackOverride !== null) {
		return isRamFallbackOverride;
	}
	return process.env.AGENT_SESSION_RAM_FALLBACK !== 'false';
}

export function classifyWriteCategory(state) {
	if (state?.pendingWrite != null) {
		return WRITE_CATEGORIES.PENDING;
	}
	if (state?.pendingWrite === null && state?.pendingSessionVersion != null) {
		return WRITE_CATEGORIES.PENDING_CLEAR;
	}
	if (state?.lastTool != null && state?.pendingWrite == null) {
		return WRITE_CATEGORIES.POST_TOOL;
	}
	return WRITE_CATEGORIES.DRAFT_CONTEXT;
}

export function mustSecurePendingForConfirmation({ requirePendingDb, state }) {
	if (!requirePendingDb || state?.pendingWrite == null) {
		return false;
	}
	if (isPendingDbRequired()) {
		return true;
	}
	if (isWriteDbFirst()) {
		return true;
	}
	return false;
}

export function recordWriterDbPrimary() {
	writeMetrics.writer_db_primary += 1;
}

export function recordWriterDbSuccess() {
	writeMetrics.writer_db_success += 1;
}

export function recordWriterDbFailure() {
	writeMetrics.writer_db_failure += 1;
}

export function recordWriterRamCacheSuccess() {
	writeMetrics.writer_ram_cache_success += 1;
}

export function recordWriterRamCacheFailure() {
	writeMetrics.writer_ram_cache_failure += 1;
}

export function recordWriterDbPrimaryFallback() {
	writeMetrics.writer_db_primary_fallback += 1;
}

export function recordPendingPersistenceOutcome(outcome) {
	if (outcome === PENDING_PERSISTENCE_OUTCOMES.SUCCESS) {
		writeMetrics.pending_persistence_success += 1;
		return;
	}
	if (outcome === PENDING_PERSISTENCE_OUTCOMES.BLOCKED_CONFIRMATION) {
		writeMetrics.pending_persistence_blocked_confirmation += 1;
	}
	writeMetrics.pending_persistence_failed += 1;
}

function pendingWriteMatches(expected, actual) {
	if (!expected || !actual || expected.tool !== actual.tool) {
		return false;
	}
	if (expected.tool === 'create_expense') {
		return expected.label === actual.label && expected.amount === actual.amount;
	}
	if (expected.tool === 'create_sale') {
		return expected.product === actual.product
			&& expected.quantity === actual.quantity
			&& (expected.unitPrice ?? null) === (actual.unitPrice ?? null)
			&& (expected.amountPaid ?? null) === (actual.amountPaid ?? null);
	}
	return false;
}

/**
 * Verify pending row exists in DB with expected pendingWrite + consumeToken (read-only).
 */
export async function verifyPendingInDb({ user, consumeToken, pendingWrite }) {
	const { pending } = await getSessionsPair({ user });
	const dbPendingWrite = pending?.payload?.pendingWrite ?? null;

	if (!dbPendingWrite) {
		return { ok: false, reason: 'PENDING_ROW_MISSING' };
	}
	if (consumeToken && pending.payload?.consumeToken !== consumeToken) {
		return { ok: false, reason: 'CONSUME_TOKEN_MISMATCH' };
	}
	if (!pendingWriteMatches(pendingWrite, dbPendingWrite)) {
		return { ok: false, reason: 'PENDING_WRITE_MISMATCH' };
	}

	return {
		ok: true,
		pendingVersion: pending.stateVersion ?? null,
		consumeToken: pending.payload?.consumeToken ?? null,
		operationId: pending.payload?.operationId ?? null,
		awaiting: pending.awaiting ?? null,
	};
}

function logMirror(meta) {
	logger.warn('[agent-session-writer]', {
		event: 'agent_session_mirror',
		...meta,
	});
}

function logAgentSessionWrite(meta) {
	logger.warn('[agent-session-writer]', {
		event: 'agent_session_write',
		...meta,
	});
}

function draftPayloadMatchesIntent(dbDraft, intendedDraft) {
	if (!dbDraft) {
		return Object.keys(intendedDraft).every((key) => intendedDraft[key] == null);
	}
	for (const key of DRAFT_PAYLOAD_KEYS) {
		if (intendedDraft[key] === undefined) {
			continue;
		}
		const intended = intendedDraft[key];
		const actual = dbDraft[key] ?? null;
		if (intended == null && actual == null) {
			continue;
		}
		if (JSON.stringify(actual) !== JSON.stringify(intended)) {
			return false;
		}
	}
	return true;
}

/**
 * Read-back compare after ambiguous mirror failure (timeout / network).
 * Returns matched | absent | diverged — never overwrites DB automatically.
 */
export async function compareDbStateToIntent({ user, state }) {
	const { draft, pending } = await getSessionsPair({ user });
	const mapped = mapAgentStateToSessions(state);

	if (!draftPayloadMatchesIntent(draft?.payload, mapped.draftPayload)) {
		if (draft?.payload) {
			return { status: 'diverged' };
		}
		return { status: 'absent' };
	}

	if (mapped.pending) {
		const dbPendingWrite = pending?.payload?.pendingWrite ?? null;
		if (!dbPendingWrite) {
			return { status: 'absent' };
		}
		if (!pendingWriteMatches(state.pendingWrite, dbPendingWrite)) {
			return { status: 'diverged' };
		}
	} else if (pending?.payload?.pendingWrite) {
		if (mapped.clearPendingVersion != null) {
			return { status: 'diverged' };
		}
		return { status: 'absent' };
	}

	return {
		status: 'matched',
		versions: {
			draftVersion: draft?.stateVersion ?? null,
			pendingVersion: pending?.stateVersion ?? null,
		},
	};
}

function applyVersionsToState(state, { mirrorResult, verification }) {
	const synced = { ...state };
	if (verification?.ok) {
		synced.pendingSessionVersion = verification.pendingVersion ?? synced.pendingSessionVersion ?? null;
		synced.pendingConsumeToken = verification.consumeToken ?? synced.pendingConsumeToken ?? null;
		synced.pendingOperationId = verification.operationId ?? synced.pendingOperationId ?? null;
	} else if (mirrorResult?.pendingVersion != null) {
		synced.pendingSessionVersion = mirrorResult.pendingVersion;
	} else if (synced.pendingWrite == null) {
		synced.pendingSessionVersion = null;
		synced.pendingConsumeToken = null;
	}
	if (synced.pendingWrite == null) {
		synced.pendingSessionVersion = null;
		synced.pendingConsumeToken = null;
		synced.pendingOperationId = null;
	}
	return synced;
}

function buildBlockedConfirmationResult(errorCode, category) {
	recordPendingPersistenceOutcome(PENDING_PERSISTENCE_OUTCOMES.BLOCKED_CONFIRMATION);
	recordWriterDbFailure();
	return {
		ok: false,
		outcome: WRITE_OUTCOMES.BLOCKED_CONFIRMATION,
		dbSuccess: false,
		blockedConfirmation: true,
		errorCode,
		category,
	};
}

/**
 * DB-first persist (F3-B). Writes DB first; caller caches RAM after success.
 * Does not invoke business write tools.
 */
export async function executeDbFirstConversationPersist({
	user,
	sessionId,
	state,
	requirePendingDb = false,
}) {
	const category = classifyWriteCategory(state);
	const securePending = mustSecurePendingForConfirmation({ requirePendingDb, state });
	const isPendingCategory = category === WRITE_CATEGORIES.PENDING || securePending;

	recordWriterDbPrimary();

	let clientId = null;
	try {
		clientId = requireClientScope(user);
	} catch {
		clientId = null;
	}

	let mirrorResult = await mirrorAgentSessionState({ user, sessionId, state });

	if (mirrorResult?.outcome !== MIRROR_OUTCOMES.SUCCESS) {
		const readBack = await compareDbStateToIntent({ user, state });
		if (readBack.status === 'matched') {
			mirrorResult = {
				outcome: MIRROR_OUTCOMES.SUCCESS,
				mirrorResult: readBack.versions,
				readBackRecovered: true,
			};
			recordWriterDbSuccess();
			logAgentSessionWrite({
				mode: 'db_first',
				category,
				outcome: 'read_back_recovered',
				userId: user?.id,
				clientId,
				sessionId,
				hasPendingWrite: state?.pendingWrite != null,
				draftVersion: readBack.versions?.draftVersion ?? null,
				pendingVersion: readBack.versions?.pendingVersion ?? null,
			});
		} else if (readBack.status === 'diverged') {
			logAgentSessionWrite({
				mode: 'db_first',
				category,
				outcome: WRITE_OUTCOMES.DB_DIVERGENCE,
				userId: user?.id,
				clientId,
				sessionId,
				hasPendingWrite: state?.pendingWrite != null,
				errorCode: 'DB_DIVERGENCE',
			});
			if (isPendingCategory) {
				return buildBlockedConfirmationResult('DB_DIVERGENCE', category);
			}
			recordWriterDbFailure();
			return {
				ok: false,
				outcome: WRITE_OUTCOMES.DB_DIVERGENCE,
				dbSuccess: false,
				errorCode: 'DB_DIVERGENCE',
				category,
			};
		}
	}

	if (mirrorResult?.outcome !== MIRROR_OUTCOMES.SUCCESS) {
		const errorCode = mirrorResult?.errorCode || 'MIRROR_NOT_SUCCESS';
		logAgentSessionWrite({
			mode: 'db_first',
			category,
			outcome: isPendingCategory ? WRITE_OUTCOMES.BLOCKED_CONFIRMATION : WRITE_OUTCOMES.DB_FAILURE,
			userId: user?.id,
			clientId,
			sessionId,
			hasPendingWrite: state?.pendingWrite != null,
			errorCode,
		});

		if (isPendingCategory) {
			return buildBlockedConfirmationResult(errorCode, category);
		}

		recordWriterDbFailure();

		if (isRamFallbackEnabled()) {
			recordWriterDbPrimaryFallback();
			return {
				ok: true,
				outcome: WRITE_OUTCOMES.RAM_FALLBACK,
				dbSuccess: false,
				ramFallback: true,
				errorCode,
				category,
				syncedState: state,
			};
		}

		return {
			ok: false,
			outcome: WRITE_OUTCOMES.DB_FAILURE,
			dbSuccess: false,
			errorCode,
			category,
		};
	}

	recordWriterDbSuccess();

	let verification = null;
	if (securePending) {
		verification = await verifyPendingInDb({
			user,
			consumeToken: state.pendingConsumeToken,
			pendingWrite: state.pendingWrite,
		});
		if (!verification.ok) {
			logAgentSessionWrite({
				mode: 'db_first',
				category,
				outcome: WRITE_OUTCOMES.BLOCKED_CONFIRMATION,
				userId: user?.id,
				clientId,
				sessionId,
				hasPendingWrite: true,
				errorCode: verification.reason,
			});
			return buildBlockedConfirmationResult(verification.reason, category);
		}
		recordPendingPersistenceOutcome(PENDING_PERSISTENCE_OUTCOMES.SUCCESS);
	}

	const mirrorVersions = mirrorResult.mirrorResult ?? {};
	const syncedState = applyVersionsToState(state, {
		mirrorResult: mirrorVersions,
		verification,
	});

	logAgentSessionWrite({
		mode: 'db_first',
		category,
		outcome: WRITE_OUTCOMES.SUCCESS,
		userId: user?.id,
		clientId,
		sessionId,
		hasPendingWrite: syncedState?.pendingWrite != null,
		draftVersion: mirrorVersions.draftVersion ?? null,
		pendingVersion: verification?.pendingVersion ?? mirrorVersions.pendingVersion ?? null,
		readBackRecovered: Boolean(mirrorResult.readBackRecovered),
	});

	return {
		ok: true,
		outcome: WRITE_OUTCOMES.SUCCESS,
		dbSuccess: true,
		category,
		draftVersion: mirrorVersions.draftVersion ?? null,
		pendingVersion: verification?.pendingVersion ?? mirrorVersions.pendingVersion ?? null,
		syncedState,
	};
}

/**
 * Split ConversationState into agent_sessions draft/pending rows.
 * RAM keys user.id+sessionId; DB keys client_id+state_type only (see Phase 5.8-D audit).
 */
export function mapAgentStateToSessions(state) {
	const draftPayload = {};
	for (const key of DRAFT_PAYLOAD_KEYS) {
		if (state[key] !== undefined) {
			draftPayload[key] = state[key];
		}
	}

	if (state.pendingWrite == null) {
		return { draftPayload, pending: null, clearPendingVersion: state.pendingSessionVersion ?? null };
	}

	const consumeToken = state.pendingConsumeToken || createPendingConsumeToken();

	return {
		draftPayload,
		pending: {
			payload: {
				pendingWrite: state.pendingWrite,
				consumeToken,
				operationId: state.pendingOperationId ?? null,
			},
			awaiting: 'confirm',
			intention: state.intent ?? state.lastAction ?? null,
			consumeToken,
		},
		clearPendingVersion: null,
	};
}

async function defaultMirrorAgentSessionState({ user, sessionId, state }) {
	if (!checkSupabaseConfigured()) {
		writeMetrics.write_db_skipped += 1;
		logMirror({
			outcome: 'skipped',
			userId: user?.id,
			sessionId,
			hasPendingWrite: state?.pendingWrite != null,
			errorCode: 'SUPABASE_UNAVAILABLE',
		});
		scheduleAgentSessionParityObservation({
			user,
			sessionId,
			mirrorOutcome: 'skipped',
			ramState: state,
		});
		return { outcome: MIRROR_OUTCOMES.SKIPPED, errorCode: 'SUPABASE_UNAVAILABLE' };
	}

	let clientId;
	try {
		clientId = requireClientScope(user);
	} catch (error) {
		writeMetrics.write_db_skipped += 1;
		logMirror({
			outcome: 'skipped',
			userId: user?.id,
			sessionId,
			hasPendingWrite: state?.pendingWrite != null,
			errorCode: error?.code || 'SUPABASE_CLIENT_SCOPE_MISSING',
		});
		scheduleAgentSessionParityObservation({
			user,
			sessionId,
			mirrorOutcome: 'skipped',
			ramState: state,
		});
		return { outcome: MIRROR_OUTCOMES.SKIPPED, errorCode: error?.code || 'SUPABASE_CLIENT_SCOPE_MISSING' };
	}

	const { draftPayload, pending, clearPendingVersion } = mapAgentStateToSessions(state);

	try {
		const mirrorResult = await mirrorSessionsAtomic({
			user,
			draftPayload,
			pendingPayload: pending?.payload ?? null,
			pendingAwaiting: pending?.awaiting ?? null,
			pendingIntention: pending?.intention ?? null,
			clearPendingVersion,
		});

		if (!pending && mirrorResult?.pendingCleared > 0) {
			writeMetrics.pending_cleared += 1;
		}

		writeMetrics.write_db_success += 1;
		logMirror({
			outcome: 'success',
			userId: user.id,
			clientId,
			sessionId,
			stateType: pending ? 'both' : 'draft',
			hasPendingWrite: pending != null,
			draftVersion: mirrorResult?.draftVersion ?? null,
			pendingVersion: mirrorResult?.pendingVersion ?? null,
			pendingCleared: mirrorResult?.pendingCleared ?? 0,
		});
		scheduleAgentSessionParityObservation({
			user,
			sessionId,
			mirrorOutcome: 'success',
			ramState: state,
		});
		return { outcome: MIRROR_OUTCOMES.SUCCESS, mirrorResult };
	} catch (error) {
		writeMetrics.write_db_failure += 1;
		logMirror({
			outcome: 'failure',
			userId: user?.id,
			clientId,
			sessionId,
			stateType: pending ? 'both' : 'draft',
			hasPendingWrite: pending != null,
			errorCode: error?.code || 'MIRROR_FAILED',
		});
		scheduleAgentSessionParityObservation({
			user,
			sessionId,
			mirrorOutcome: 'failure',
			ramState: state,
		});
		return { outcome: MIRROR_OUTCOMES.FAILURE, errorCode: error?.code || 'MIRROR_FAILED' };
	}
}

/**
 * Mirror ConversationState to agent_sessions. Never throws — FAIL_OPEN on DB errors.
 * Does not invoke any business write tools.
 */
export async function mirrorAgentSessionState({ user, sessionId, state }) {
	if (mirrorImpl) {
		return mirrorImpl({ user, sessionId, state });
	}
	return defaultMirrorAgentSessionState({ user, sessionId, state });
}

export function shouldAwaitAgentSessionMirror() {
	return process.env.AGENT_SESSION_MIRROR_AWAIT === 'true';
}
