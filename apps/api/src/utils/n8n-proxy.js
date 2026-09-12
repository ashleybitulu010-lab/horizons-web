const IDENTITY_BODY_KEYS = new Set([
	'userId',
	'user_id',
	'pbUserId',
	'pb_user_id',
	'clientId',
	'client_id',
	'email',
	'firstName',
	'lastName',
	'first_name',
	'last_name',
	'airtableId',
	'airtable_id',
]);

const CHAT_DEDUP_KEYS = new Set([
	'message',
	'sessionId',
	'session_id',
	'chatInput',
]);

/**
 * Forward safe client metadata to n8n while overriding identity fields from req.user.
 */
export function buildN8nChatPayload(req) {
	const body = req.body ?? {};
	const { message, sessionId } = body;
	const user = req.user;
	const trustedUserId = user.businessUserId || user.id;
	const resolvedSessionId = sessionId || body.session_id || trustedUserId || 'default';

	const passthrough = {};
	for (const [key, value] of Object.entries(body)) {
		if (IDENTITY_BODY_KEYS.has(key) || CHAT_DEDUP_KEYS.has(key)) continue;
		passthrough[key] = value;
	}

	return {
		...passthrough,
		message: message.trim(),
		chatInput: message.trim(),
		sessionId: resolvedSessionId,
		session_id: resolvedSessionId,
		userId: trustedUserId,
		pbUserId: user.id,
		airtableId: user.airtableId || null,
		firstName: user.firstName || body.firstName || '',
		lastName: user.lastName || body.lastName || '',
		email: user.email || body.email || '',
	};
}

/**
 * Passthrough fields the frontend expects from n8n chat responses (PDF, etc.).
 */
export function buildN8nChatClientResponse(data, reply) {
	const payload = {
		reply: typeof reply === 'string' ? reply : String(reply),
	};

	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		return payload;
	}

	if (typeof data.pdf_base64 === 'string' && data.pdf_base64.length > 0) {
		payload.pdf_base64 = data.pdf_base64;
	}
	if (typeof data.filename === 'string' && data.filename.trim()) {
		payload.filename = data.filename.trim();
	}
	if (typeof data.type === 'string' && data.type.trim()) {
		payload.type = data.type.trim();
	}
	if (typeof data.mime_type === 'string' && data.mime_type.trim()) {
		payload.mime_type = data.mime_type.trim();
	}

	return payload;
}

export function extractN8nChatReply(data) {
	if (!data) return null;
	if (typeof data === 'string') return data;

	return data.output
		?? data.reply
		?? data.text
		?? data.message
		?? data.answer
		?? data.response
		?? (Array.isArray(data) && data[0]?.output)
		?? null;
}

export function truncateProxyLogBody(rawBody, max = 500) {
	if (!rawBody) return rawBody;
	if (rawBody.length <= max && !/pdf_base64/i.test(rawBody)) return rawBody;
	if (/pdf_base64/i.test(rawBody)) {
		return `[truncated ${rawBody.length} chars; pdf_base64 omitted from logs]`;
	}
	return `${rawBody.slice(0, max)}…`;
}

/**
 * Forward safe metadata for thread message persistence webhooks.
 */
export function buildN8nSaveMessagePayload(req) {
	const body = req.body ?? {};
	const user = req.user;
	const trustedUserId = user.businessUserId || user.id;

	const passthrough = {};
	for (const [key, value] of Object.entries(body)) {
		if (IDENTITY_BODY_KEYS.has(key) || key === 'role' || key === 'content' || key === 'timestamp') {
			continue;
		}
		passthrough[key] = value;
	}

	return {
		...passthrough,
		userId: trustedUserId,
		pbUserId: user.id,
		role: body.role,
		content: body.content,
		timestamp: body.timestamp || new Date().toISOString(),
		email: user.email || body.email || '',
		firstName: user.firstName || body.firstName || '',
		lastName: user.lastName || body.lastName || '',
	};
}
