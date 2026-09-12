import { getSupabaseAdmin } from '../supabase/client.js';
import { isSupabaseConfigured } from '../config/env.js';
import { getBusinessScope } from './supabase-scoped.js';

export const CHAT_MESSAGES_TABLE = 'chat_messages';
export const VALID_ROLES = Object.freeze(['user', 'assistant']);
export const VALID_SOURCES = Object.freeze(['backend', 'n8n', 'migration', 'frontend']);
export const MAX_CONTENT_LENGTH = 16000;
export const MAX_METADATA_BYTES = 4096;
export const DEFAULT_LIST_LIMIT = 500;
export const MAX_LIST_LIMIT = 1000;

export class ConversationServiceError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'ConversationServiceError';
		this.code = code;
	}
}

let allocateSequenceImpl = null;
let insertMessageImpl = null;
let listMessagesImpl = null;

export function setAllocateSequenceImplForTests(impl) {
	allocateSequenceImpl = impl;
}

export function setInsertMessageImplForTests(impl) {
	insertMessageImpl = impl;
}

export function setListMessagesImplForTests(impl) {
	listMessagesImpl = impl;
}

export function resetConversationServiceImplForTests() {
	allocateSequenceImpl = null;
	insertMessageImpl = null;
	listMessagesImpl = null;
}

function assertAuthenticatedUser(user) {
	if (!user || typeof user !== 'object') {
		throw new ConversationServiceError('USER_REQUIRED', 'Authenticated user is required');
	}
}

function assertSupabaseAvailable() {
	if (!isSupabaseConfigured()) {
		throw new ConversationServiceError('SUPABASE_UNAVAILABLE', 'Supabase is not configured');
	}
}

function normalizeRole(role) {
	if (typeof role !== 'string') return null;
	const normalized = role.trim().toLowerCase();
	return VALID_ROLES.includes(normalized) ? normalized : null;
}

function normalizeSource(source) {
	if (typeof source !== 'string') return null;
	const normalized = source.trim().toLowerCase();
	return VALID_SOURCES.includes(normalized) ? normalized : null;
}

function normalizeContent(content) {
	if (content == null) return '';
	return String(content);
}

export function validateAppendMessageInput({ role, content, source = 'backend', metadata = {} }) {
	const normalizedRole = normalizeRole(role);
	if (!normalizedRole) {
		throw new ConversationServiceError('INVALID_ROLE', 'role must be user or assistant');
	}

	const normalizedContent = normalizeContent(content);
	if (!normalizedContent.trim()) {
		throw new ConversationServiceError('EMPTY_CONTENT', 'content must not be empty');
	}
	if (normalizedContent.length > MAX_CONTENT_LENGTH) {
		throw new ConversationServiceError('CONTENT_TOO_LONG', `content must not exceed ${MAX_CONTENT_LENGTH} characters`);
	}

	const normalizedSource = normalizeSource(source);
	if (!normalizedSource) {
		throw new ConversationServiceError('INVALID_SOURCE', 'source must be backend, n8n, migration, or frontend');
	}

	if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) {
		throw new ConversationServiceError('INVALID_METADATA', 'metadata must be a plain object');
	}

	const metadataBytes = Buffer.byteLength(JSON.stringify(metadata), 'utf8');
	if (metadataBytes > MAX_METADATA_BYTES) {
		throw new ConversationServiceError('METADATA_TOO_LARGE', `metadata must not exceed ${MAX_METADATA_BYTES} bytes`);
	}

	return {
		role: normalizedRole,
		content: normalizedContent,
		source: normalizedSource,
		metadata,
	};
}

function normalizeListLimit(limit) {
	if (limit == null) return DEFAULT_LIST_LIMIT;
	const parsed = Number(limit);
	if (!Number.isFinite(parsed) || parsed < 1) {
		throw new ConversationServiceError('INVALID_LIMIT', 'limit must be a positive number');
	}
	return Math.min(Math.floor(parsed), MAX_LIST_LIMIT);
}

function normalizeAfterSequence(afterSequence) {
	if (afterSequence == null) return null;
	const parsed = Number(afterSequence);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new ConversationServiceError('INVALID_AFTER_SEQUENCE', 'afterSequence must be a non-negative number');
	}
	return Math.floor(parsed);
}

function mapMessageRow(row) {
	return {
		id: row.id,
		clientId: row.client_id,
		activityId: row.activity_id,
		role: row.role,
		content: row.content,
		sequence: row.sequence,
		source: row.source,
		metadata: row.metadata ?? {},
		createdAt: row.created_at,
	};
}

function sanitizeDbError(err, fallbackCode, fallbackMessage) {
	const message = String(err?.message || '');
	if (/service_role|supabase.*key|postgres|connection|password|secret/i.test(message)) {
		return new ConversationServiceError(fallbackCode, fallbackMessage);
	}
	return new ConversationServiceError(fallbackCode, fallbackMessage);
}

async function defaultAllocateSequence(clientId, activityId) {
	assertSupabaseAvailable();
	const admin = getSupabaseAdmin();
	if (!admin) {
		throw new ConversationServiceError('SUPABASE_UNAVAILABLE', 'Supabase client is unavailable');
	}

	const { data, error } = await admin.rpc('allocate_chat_message_sequence', {
		p_client_id: clientId,
		p_activity_id: activityId,
	});

	if (error) {
		throw sanitizeDbError(error, 'SEQUENCE_ALLOCATION_FAILED', 'Unable to allocate message sequence');
	}

	if (!Number.isFinite(Number(data))) {
		throw new ConversationServiceError('SEQUENCE_ALLOCATION_FAILED', 'Invalid sequence returned from allocator');
	}

	return Number(data);
}

async function allocateSequence(clientId, activityId) {
	if (allocateSequenceImpl) {
		return allocateSequenceImpl(clientId, activityId);
	}
	return defaultAllocateSequence(clientId, activityId);
}

async function defaultInsertMessage(clientId, activityId, row) {
	assertSupabaseAvailable();
	const admin = getSupabaseAdmin();
	if (!admin) {
		throw new ConversationServiceError('SUPABASE_UNAVAILABLE', 'Supabase client is unavailable');
	}

	const payload = {
		client_id: clientId,
		activity_id: activityId,
		sequence: row.sequence,
		role: row.role,
		content: row.content,
		source: row.source,
		metadata: row.metadata,
		created_at: row.source === 'migration' ? null : new Date().toISOString(),
	};

	const { data, error } = await admin
		.from(CHAT_MESSAGES_TABLE)
		.insert(payload)
		.select('id, client_id, activity_id, role, content, sequence, source, metadata, created_at')
		.single();

	if (error) {
		throw sanitizeDbError(error, 'INSERT_FAILED', 'Unable to save chat message');
	}

	return mapMessageRow(data);
}

async function insertMessage(clientId, activityId, row) {
	if (insertMessageImpl) {
		return insertMessageImpl(clientId, activityId, row);
	}
	return defaultInsertMessage(clientId, activityId, row);
}

async function defaultListMessages(clientId, activityId, { limit, afterSequence }) {
	assertSupabaseAvailable();
	const admin = getSupabaseAdmin();
	if (!admin) {
		throw new ConversationServiceError('SUPABASE_UNAVAILABLE', 'Supabase client is unavailable');
	}

	let query = admin
		.from(CHAT_MESSAGES_TABLE)
		.select('id, client_id, activity_id, role, content, sequence, source, metadata, created_at')
		.eq('client_id', clientId)
		.eq('activity_id', activityId)
		.order('sequence', { ascending: true });

	if (afterSequence != null) {
		query = query.gt('sequence', afterSequence);
	}

	if (limit != null) {
		query = query.limit(limit);
	}

	const { data, error } = await query;

	if (error) {
		throw sanitizeDbError(error, 'SELECT_FAILED', 'Unable to retrieve chat messages');
	}

	return (data || []).map(mapMessageRow);
}

async function queryMessages(clientId, activityId, options) {
	if (listMessagesImpl) {
		return listMessagesImpl(clientId, activityId, options);
	}
	return defaultListMessages(clientId, activityId, options);
}

/**
 * Append a chat message for the authenticated user's business scope.
 * client_id, activity_id, and sequence are never accepted from callers.
 */
export async function appendMessage({
	user,
	role,
	content,
	source = 'backend',
	metadata = {},
}) {
	assertAuthenticatedUser(user);
	const { clientId, activityId } = getBusinessScope(user);
	const validated = validateAppendMessageInput({ role, content, source, metadata });
	const sequence = await allocateSequence(clientId, activityId);

	return insertMessage(clientId, activityId, {
		...validated,
		sequence,
	});
}

/**
 * List chat messages for the authenticated user's active activity scope.
 * Results are ordered by sequence ASC.
 */
export async function listMessages({
	user,
	limit,
	afterSequence,
} = {}) {
	assertAuthenticatedUser(user);
	const { clientId, activityId } = getBusinessScope(user);
	const normalizedLimit = normalizeListLimit(limit);
	const normalizedAfterSequence = normalizeAfterSequence(afterSequence);

	const messages = await queryMessages(clientId, activityId, {
		limit: normalizedLimit,
		afterSequence: normalizedAfterSequence,
	});

	return {
		messages,
		count: messages.length,
	};
}
