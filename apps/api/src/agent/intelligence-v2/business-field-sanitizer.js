import { SQL_INJECTION_PATTERN, UUID_PATTERN } from './constants.js';

/**
 * Internal control metadata — never part of user-facing business fields.
 * Matches camelCase, snake_case, and case variants (clientId, CLIENTID, client_id).
 */
const INTERNAL_CONTROL_KEY_NAMES = Object.freeze([
	'clientId',
	'client_id',
	'activityId',
	'activity_id',
	'userId',
	'user_id',
	'operationId',
	'operation_id',
	'tenantId',
	'tenant_id',
	'businessUserId',
	'business_user_id',
	'sessionId',
	'session_id',
	'consumeToken',
	'consume_token',
	'pendingOperationId',
	'pending_operation_id',
	'requestHash',
	'request_hash',
	'authUserId',
	'auth_user_id',
	'threadId',
	'thread_id',
]);

const CONTROL_KEY_PATTERN = INTERNAL_CONTROL_KEY_NAMES
	.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
	.join('|');

/** key=value control pairs — case insensitive key names. */
const KEY_VALUE_CONTROL_PATTERN = new RegExp(
	`(?:^|[\\s,;])(${CONTROL_KEY_PATTERN})\\s*=\\s*(?:['"\`][^'"\`]*['"\`]|[^\\s,;]+)`,
	'gi',
);

/** Standalone UUID tokens in free text. */
const UUID_INLINE_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

/** Bearer / JWT-like authorization fragments. */
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

const BUSINESS_FIELD_KEYS = Object.freeze([
	'label',
	'product',
	'category',
	'description',
	'note',
]);

function collapseWhitespace(text) {
	return String(text).replace(/\s+/g, ' ').trim();
}

function trimPeripheralPunctuation(text) {
	return String(text).replace(/^[\s,;.:]+|[\s,;.:]+$/g, '').trim();
}

/**
 * Remove injected control metadata from a single business-text fragment.
 * Preserves legitimate business wording; strips IDs, scope keys, and auth tokens.
 */
export function stripControlMetadataFromBusinessText(text) {
	if (text == null) {
		return null;
	}

	let cleaned = String(text);
	cleaned = cleaned.replace(KEY_VALUE_CONTROL_PATTERN, ' ');
	cleaned = cleaned.replace(UUID_INLINE_PATTERN, ' ');
	cleaned = cleaned.replace(BEARER_PATTERN, ' ');

	if (SQL_INJECTION_PATTERN.test(cleaned)) {
		cleaned = cleaned.replace(SQL_INJECTION_PATTERN, ' ');
	}

	cleaned = trimPeripheralPunctuation(collapseWhitespace(cleaned));
	return cleaned || null;
}

/**
 * Returns true when the input contains removable control metadata.
 */
export function containsInjectedControlMetadata(text) {
	if (text == null || typeof text !== 'string') {
		return false;
	}

	const original = collapseWhitespace(text);
	const stripped = stripControlMetadataFromBusinessText(original) || '';
	return stripped !== original;
}

/**
 * Sanitize one business field value (label, product, category, description, etc.).
 */
export function sanitizeBusinessFieldValue(value) {
	if (value == null) {
		return null;
	}
	return stripControlMetadataFromBusinessText(String(value).trim());
}

/**
 * Sanitize string values inside goal/action parameter objects.
 */
export function sanitizeBusinessParameters(parameters = {}) {
	if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
		return parameters;
	}

	/** @type {Record<string, unknown>} */
	const sanitized = { ...parameters };

	for (const [key, value] of Object.entries(sanitized)) {
		if (typeof value === 'string') {
			sanitized[key] = sanitizeBusinessFieldValue(value);
		}
	}

	return sanitized;
}

/**
 * Sanitize known business fields on an action proposal field bag.
 */
export function sanitizeActionBusinessFields(fields = {}) {
	if (!fields || typeof fields !== 'object') {
		return fields;
	}

	/** @type {Record<string, unknown>} */
	const sanitized = { ...fields };

	for (const key of BUSINESS_FIELD_KEYS) {
		if (typeof sanitized[key] === 'string') {
			sanitized[key] = sanitizeBusinessFieldValue(sanitized[key]);
		}
	}

	return sanitized;
}

/**
 * Detect whether a value is a bare UUID (after trim).
 */
export function isBareUuid(value) {
	if (value == null) {
		return false;
	}
	return UUID_PATTERN.test(String(value).trim());
}
