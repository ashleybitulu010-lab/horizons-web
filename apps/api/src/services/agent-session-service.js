import { randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from '../supabase/client.js';
import { isSupabaseConfigured } from '../config/env.js';
import { getBusinessScope } from './supabase-scoped.js';

export const AGENT_SESSIONS_TABLE = 'agent_sessions';
export const VALID_STATE_TYPES = Object.freeze(['draft', 'pending']);
export const VALID_AWAITING_VALUES = Object.freeze(['slots', 'confirm', 'price_choice']);
export const MAX_PAYLOAD_BYTES = 65536;

export class AgentSessionServiceError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'AgentSessionServiceError';
		this.code = code;
	}
}

let getSessionImpl = null;
let saveSessionImpl = null;
let clearSessionImpl = null;
let getSessionsPairImpl = null;
let mirrorSessionsAtomicImpl = null;
let consumeAgentPendingImpl = null;

export function setGetSessionImplForTests(impl) {
	getSessionImpl = impl;
}

export function setSaveSessionImplForTests(impl) {
	saveSessionImpl = impl;
}

export function setClearSessionImplForTests(impl) {
	clearSessionImpl = impl;
}

export function setGetSessionsPairImplForTests(impl) {
	getSessionsPairImpl = impl;
}

export function setMirrorSessionsAtomicImplForTests(impl) {
	mirrorSessionsAtomicImpl = impl;
}

export function setConsumeAgentPendingImplForTests(impl) {
	consumeAgentPendingImpl = impl;
}

export function resetAgentSessionServiceImplForTests() {
	getSessionImpl = null;
	saveSessionImpl = null;
	clearSessionImpl = null;
	getSessionsPairImpl = null;
	mirrorSessionsAtomicImpl = null;
	consumeAgentPendingImpl = null;
}

function assertAuthenticatedUser(user) {
	if (!user || typeof user !== 'object') {
		throw new AgentSessionServiceError('USER_REQUIRED', 'Authenticated user is required');
	}
}

function assertSupabaseAvailable() {
	if (!isSupabaseConfigured()) {
		throw new AgentSessionServiceError('SUPABASE_UNAVAILABLE', 'Supabase is not configured');
	}
}

function normalizeStateType(stateType) {
	if (typeof stateType !== 'string') return null;
	const normalized = stateType.trim().toLowerCase();
	return VALID_STATE_TYPES.includes(normalized) ? normalized : null;
}

function normalizeAwaiting(awaiting) {
	if (awaiting == null) return null;
	if (typeof awaiting !== 'string') return null;
	const normalized = awaiting.trim().toLowerCase();
	return VALID_AWAITING_VALUES.includes(normalized) ? normalized : null;
}

function normalizeIntention(intention) {
	if (intention == null) return null;
	if (typeof intention !== 'string') return null;
	const trimmed = intention.trim();
	return trimmed || null;
}

function sanitizeDbError(err, fallbackCode, fallbackMessage) {
	const message = String(err?.message || '');
	if (/service_role|supabase.*key|postgres|connection|password|secret/i.test(message)) {
		return new AgentSessionServiceError(fallbackCode, fallbackMessage);
	}
	return new AgentSessionServiceError(fallbackCode, fallbackMessage);
}

export function validateSessionPayload(payload) {
	if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
		throw new AgentSessionServiceError('INVALID_PAYLOAD', 'payload must be a plain object');
	}

	const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
	if (payloadBytes > MAX_PAYLOAD_BYTES) {
		throw new AgentSessionServiceError(
			'PAYLOAD_TOO_LARGE',
			`payload must not exceed ${MAX_PAYLOAD_BYTES} bytes`,
		);
	}

	return payload;
}

export function validateSaveSessionInput({
	stateType,
	payload,
	awaiting = null,
	intention = null,
}) {
	const normalizedStateType = normalizeStateType(stateType);
	if (!normalizedStateType) {
		throw new AgentSessionServiceError(
			'INVALID_STATE_TYPE',
			'stateType must be draft or pending',
		);
	}

	const normalizedPayload = validateSessionPayload(payload);

	if (awaiting != null && normalizeAwaiting(awaiting) == null) {
		throw new AgentSessionServiceError(
			'INVALID_AWAITING',
			'awaiting must be slots, confirm, or price_choice',
		);
	}

	if (intention != null && typeof intention !== 'string') {
		throw new AgentSessionServiceError('INVALID_INTENTION', 'intention must be a string or null');
	}

	return {
		stateType: normalizedStateType,
		payload: normalizedPayload,
		awaiting: normalizeAwaiting(awaiting),
		intention: normalizeIntention(intention),
	};
}

function mapSessionRow(row) {
	if (!row) return null;

	return {
		id: row.id,
		clientId: row.client_id,
		activityId: row.activity_id,
		stateType: row.state_type,
		payload: row.payload ?? {},
		intention: row.intention ?? null,
		awaiting: row.awaiting ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		stateVersion: row.state_version ?? 1,
	};
}

async function defaultGetSession(scope, stateType) {
	assertSupabaseAvailable();
	const admin = getSupabaseAdmin();
	if (!admin) {
		throw new AgentSessionServiceError('SUPABASE_UNAVAILABLE', 'Supabase client is unavailable');
	}

	const { data, error } = await admin
		.from(AGENT_SESSIONS_TABLE)
		.select('id, client_id, activity_id, state_type, payload, intention, awaiting, created_at, updated_at, state_version')
		.eq('client_id', scope.clientId)
		.eq('activity_id', scope.activityId)
		.eq('state_type', stateType)
		.maybeSingle();

	if (error) {
		throw sanitizeDbError(error, 'SELECT_FAILED', 'Unable to retrieve agent session');
	}

	return mapSessionRow(data);
}

async function defaultSaveSession(scope, row) {
	assertSupabaseAvailable();
	const admin = getSupabaseAdmin();
	if (!admin) {
		throw new AgentSessionServiceError('SUPABASE_UNAVAILABLE', 'Supabase client is unavailable');
	}

	const upsertRow = {
		client_id: scope.clientId,
		activity_id: scope.activityId,
		state_type: row.stateType,
		payload: row.payload,
		intention: row.intention,
		awaiting: row.awaiting,
	};

	const { data, error } = await admin
		.from(AGENT_SESSIONS_TABLE)
		.upsert(upsertRow, { onConflict: 'client_id,activity_id,state_type' })
		.select('id, client_id, activity_id, state_type, payload, intention, awaiting, created_at, updated_at, state_version')
		.single();

	if (error) {
		throw sanitizeDbError(error, 'UPSERT_FAILED', 'Unable to save agent session');
	}

	return mapSessionRow(data);
}

async function defaultClearSession(scope, stateType) {
	assertSupabaseAvailable();
	const admin = getSupabaseAdmin();
	if (!admin) {
		throw new AgentSessionServiceError('SUPABASE_UNAVAILABLE', 'Supabase client is unavailable');
	}

	const { data, error } = await admin
		.from(AGENT_SESSIONS_TABLE)
		.delete()
		.eq('client_id', scope.clientId)
		.eq('activity_id', scope.activityId)
		.eq('state_type', stateType)
		.select('id');

	if (error) {
		throw sanitizeDbError(error, 'DELETE_FAILED', 'Unable to clear agent session');
	}

	return { deleted: Array.isArray(data) ? data.length : 0 };
}

async function defaultGetSessionsPair(scope) {
	assertSupabaseAvailable();
	const admin = getSupabaseAdmin();
	if (!admin) {
		throw new AgentSessionServiceError('SUPABASE_UNAVAILABLE', 'Supabase client is unavailable');
	}

	const { data, error } = await admin
		.from(AGENT_SESSIONS_TABLE)
		.select('id, client_id, activity_id, state_type, payload, intention, awaiting, created_at, updated_at, state_version')
		.eq('client_id', scope.clientId)
		.eq('activity_id', scope.activityId);

	if (error) {
		throw sanitizeDbError(error, 'SELECT_FAILED', 'Unable to retrieve agent sessions');
	}

	const rows = Array.isArray(data) ? data : [];
	let draft = null;
	let pending = null;
	for (const row of rows) {
		const mapped = mapSessionRow(row);
		if (mapped?.stateType === 'draft') draft = mapped;
		if (mapped?.stateType === 'pending') pending = mapped;
	}
	return { draft, pending };
}

async function defaultMirrorSessionsAtomic(scope, params) {
	assertSupabaseAvailable();
	const admin = getSupabaseAdmin();
	if (!admin) {
		throw new AgentSessionServiceError('SUPABASE_UNAVAILABLE', 'Supabase client is unavailable');
	}

	const { data, error } = await admin.rpc('mirror_agent_sessions_atomic', {
		p_client_id: scope.clientId,
		p_activity_id: scope.activityId,
		p_draft_payload: params.draftPayload,
		p_pending_payload: params.pendingPayload ?? null,
		p_pending_awaiting: params.pendingAwaiting ?? null,
		p_pending_intention: params.pendingIntention ?? null,
		p_clear_pending_version: params.clearPendingVersion ?? null,
	});

	if (error) {
		throw sanitizeDbError(error, 'MIRROR_ATOMIC_FAILED', 'Unable to mirror agent sessions atomically');
	}

	return data ?? {};
}

async function defaultConsumeAgentPending(scope, { expectedVersion = null, consumeToken = null } = {}) {
	assertSupabaseAvailable();
	const admin = getSupabaseAdmin();
	if (!admin) {
		throw new AgentSessionServiceError('SUPABASE_UNAVAILABLE', 'Supabase client is unavailable');
	}

	const { data, error } = await admin.rpc('consume_agent_pending', {
		p_client_id: scope.clientId,
		p_activity_id: scope.activityId,
		p_expected_version: expectedVersion,
		p_consume_token: consumeToken,
	});

	if (error) {
		throw sanitizeDbError(error, 'CONSUME_PENDING_FAILED', 'Unable to consume agent pending');
	}

	return data ?? { status: 'ERROR' };
}

export function createPendingConsumeToken() {
	return randomUUID();
}

/**
 * Load one agent session for the authenticated user's client scope.
 * client_id always comes from user.clientId — never from caller-supplied tenant hints.
 */
export async function getSession({ user, stateType }) {
	assertAuthenticatedUser(user);
	const scope = getBusinessScope(user);
	const normalizedStateType = normalizeStateType(stateType);
	if (!normalizedStateType) {
		throw new AgentSessionServiceError('INVALID_STATE_TYPE', 'stateType must be draft or pending');
	}

	if (getSessionImpl) {
		return getSessionImpl(scope, normalizedStateType);
	}
	return defaultGetSession(scope, normalizedStateType);
}

/**
 * Create or replace an agent session row for the authenticated client.
 * Uses PostgreSQL upsert on (client_id, activity_id, state_type).
 */
export async function saveSession({
	user,
	stateType,
	payload,
	awaiting = null,
	intention = null,
}) {
	assertAuthenticatedUser(user);
	const scope = getBusinessScope(user);
	const validated = validateSaveSessionInput({ stateType, payload, awaiting, intention });

	if (saveSessionImpl) {
		return saveSessionImpl(scope, validated);
	}
	return defaultSaveSession(scope, validated);
}

/**
 * Delete one agent session for the authenticated client.
 */
export async function clearSession({ user, stateType }) {
	assertAuthenticatedUser(user);
	const scope = getBusinessScope(user);
	const normalizedStateType = normalizeStateType(stateType);
	if (!normalizedStateType) {
		throw new AgentSessionServiceError('INVALID_STATE_TYPE', 'stateType must be draft or pending');
	}

	if (clearSessionImpl) {
		return clearSessionImpl(scope, normalizedStateType);
	}
	return defaultClearSession(scope, normalizedStateType);
}

/**
 * Load draft + pending in a single query (consistent snapshot at query time).
 */
export async function getSessionsPair({ user }) {
	assertAuthenticatedUser(user);
	const scope = getBusinessScope(user);

	if (getSessionsPairImpl) {
		return getSessionsPairImpl(scope);
	}
	return defaultGetSessionsPair(scope);
}

/**
 * Atomically mirror draft + pending/clear in one PostgreSQL transaction.
 */
export async function mirrorSessionsAtomic({
	user,
	draftPayload,
	pendingPayload = null,
	pendingAwaiting = null,
	pendingIntention = null,
	clearPendingVersion = null,
}) {
	assertAuthenticatedUser(user);
	const scope = getBusinessScope(user);
	validateSessionPayload(draftPayload);
	if (pendingPayload != null) {
		validateSessionPayload(pendingPayload);
	}

	const params = {
		draftPayload,
		pendingPayload,
		pendingAwaiting,
		pendingIntention,
		clearPendingVersion,
	};

	if (mirrorSessionsAtomicImpl) {
		return mirrorSessionsAtomicImpl(scope, params);
	}
	return defaultMirrorSessionsAtomic(scope, params);
}

export const CONSUME_PENDING_STATUS = Object.freeze({
	CONSUMED: 'CONSUMED',
	ALREADY_CONSUMED: 'ALREADY_CONSUMED',
	VERSION_MISMATCH: 'VERSION_MISMATCH',
});

/**
 * Atomically consume a pending confirmation row before executing business write.
 */
export async function consumeAgentPending({
	user,
	expectedVersion = null,
	consumeToken = null,
}) {
	assertAuthenticatedUser(user);
	const scope = getBusinessScope(user);

	if (expectedVersion == null && !consumeToken) {
		throw new AgentSessionServiceError(
			'CONSUME_TOKEN_REQUIRED',
			'expectedVersion or consumeToken is required',
		);
	}

	if (consumeAgentPendingImpl) {
		return consumeAgentPendingImpl(scope, { expectedVersion, consumeToken });
	}
	return defaultConsumeAgentPending(scope, { expectedVersion, consumeToken });
}
