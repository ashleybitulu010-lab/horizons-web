import logger from '../utils/logger.js';
import { appendMessage } from './conversation-service.js';
import { extractN8nChatReply } from '../utils/n8n-proxy.js';
import { buildN8nExternalKey } from '../utils/n8n-idempotency.js';

/** @type {typeof appendMessage | null} */
let appendMessageFn = null;

export function setN8nChatAppendMessageForTests(fn) {
	appendMessageFn = fn;
}

export function resetN8nChatPersistenceForTests() {
	appendMessageFn = null;
}

async function callAppendMessage(params) {
	const fn = appendMessageFn || appendMessage;
	return fn(params);
}

function logPersistenceFailure(err, role, user, route = '/chat') {
	logger.warn('[n8n-chat] conversation persistence failed', {
		code: err?.code || 'UNKNOWN',
		role,
		route,
		userId: user?.id,
	});
}

function buildUserMetadata(user, content) {
	const metadata = { route: 'n8n_chat' };
	if (user?.clientId) {
		metadata.external_key = buildN8nExternalKey({
			clientId: user.clientId,
			role: 'user',
			content,
		});
	}
	return metadata;
}

function buildAssistantMetadata(user, parsedData, content) {
	const metadata = { route: 'n8n_chat' };

	if (user?.clientId) {
		metadata.external_key = buildN8nExternalKey({
			clientId: user.clientId,
			role: 'assistant',
			content,
		});
	}

	if (parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)) {
		if (typeof parsedData.filename === 'string' && parsedData.filename.trim()) {
			metadata.filename = parsedData.filename.trim();
		}
		const mime = parsedData.mime_type || parsedData.mimeType;
		if (typeof mime === 'string' && mime.trim()) {
			metadata.mime_type = mime.trim();
		}
		if (typeof parsedData.type === 'string' && parsedData.type.trim()) {
			metadata.type = parsedData.type.trim();
		}
		if (parsedData.pdf_base64) {
			metadata.has_pdf = true;
		}
	}

	return metadata;
}

/**
 * Parse n8n upstream body into client reply + whether assistant should be persisted.
 */
export function parseN8nChatUpstreamResponse(rawBody, contentType = '') {
	if (!rawBody || !rawBody.trim()) {
		return {
			reply: "L'agent n'a pas renvoyé de réponse. Veuillez réessayer.",
			parsedData: null,
			persistAssistant: false,
		};
	}

	const trimmed = rawBody.trim();
	const looksJson = contentType.includes('application/json')
		|| trimmed.startsWith('{')
		|| trimmed.startsWith('[');

	if (looksJson) {
		try {
			const parsedData = JSON.parse(trimmed);
			const extracted = extractN8nChatReply(parsedData);
			if (extracted && String(extracted).trim()) {
				return {
					reply: String(extracted).trim(),
					parsedData,
					persistAssistant: true,
				};
			}
			return {
				reply: "Je n'ai pas reçu de réponse compréhensible de l'agent.",
				parsedData,
				persistAssistant: false,
			};
		} catch {
			return {
				reply: trimmed,
				parsedData: null,
				persistAssistant: true,
			};
		}
	}

	return {
		reply: trimmed,
		parsedData: null,
		persistAssistant: true,
	};
}

/**
 * Persist user turn for POST /chat (n8n path). Non-blocking on failure.
 */
export async function persistN8nUserMessage(user, content) {
	const text = String(content || '').trim();
	if (!text) {
		return { saved: false, code: 'EMPTY_MESSAGE' };
	}

	const metadata = buildUserMetadata(user, text);

	try {
		await callAppendMessage({
			user,
			role: 'user',
			content: text,
			source: 'n8n',
			metadata,
		});
		return { saved: true };
	} catch (err) {
		logPersistenceFailure(err, 'user', user);
		return { saved: false, code: err?.code || 'PERSISTENCE_FAILED' };
	}
}

/**
 * Persist assistant reply after valid n8n response. Non-blocking on failure.
 */
export async function persistN8nAssistantMessage(user, reply, parsedData) {
	const text = String(reply || '').trim();
	if (!text) {
		return { saved: false, code: 'EMPTY_REPLY' };
	}

	try {
		await callAppendMessage({
			user,
			role: 'assistant',
			content: text,
			source: 'n8n',
			metadata: buildAssistantMetadata(user, parsedData, text),
		});
		return { saved: true };
	} catch (err) {
		logPersistenceFailure(err, 'assistant', user);
		return { saved: false, code: err?.code || 'PERSISTENCE_FAILED' };
	}
}
