import logger from '../../utils/logger.js';
import { appendMessage } from '../../services/conversation-service.js';

/** @type {typeof appendMessage | null} */
let appendMessageFn = null;

export function setAshyChatAppendMessageForTests(fn) {
	appendMessageFn = fn;
}

export function resetAshyChatPersistenceForTests() {
	appendMessageFn = null;
}

async function callAppendMessage(params) {
	const fn = appendMessageFn || appendMessage;
	return fn(params);
}

function logPersistenceFailure(err, role, user) {
	logger.warn('[ashy-chat] conversation persistence failed', {
		code: err?.code || 'UNKNOWN',
		role,
		userId: user?.id,
	});
}

function buildAssistantMetadata(toolResults) {
	const metadata = { route: 'ashy' };
	if (Array.isArray(toolResults) && toolResults.length > 0) {
		const tools = toolResults.map((entry) => entry?.tool).filter(Boolean);
		if (tools.length > 0) {
			metadata.tools = tools;
		}
	}
	return metadata;
}

/**
 * Persist the user turn. Non-blocking for Ashy — logs and returns status on failure.
 */
export async function persistAshyUserMessage(user, content) {
	try {
		await callAppendMessage({
			user,
			role: 'user',
			content,
			source: 'backend',
			metadata: {},
		});
		return { saved: true };
	} catch (err) {
		logPersistenceFailure(err, 'user', user);
		return { saved: false, code: err?.code || 'PERSISTENCE_FAILED' };
	}
}

/**
 * Persist the assistant reply. Non-blocking — Ashy HTTP response must still succeed.
 */
export async function persistAshyAssistantMessage(user, reply, toolResults) {
	const text = String(reply || '').trim();
	if (!text) {
		return { saved: false, code: 'EMPTY_REPLY' };
	}

	try {
		await callAppendMessage({
			user,
			role: 'assistant',
			content: text,
			source: 'backend',
			metadata: buildAssistantMetadata(toolResults),
		});
		return { saved: true };
	} catch (err) {
		logPersistenceFailure(err, 'assistant', user);
		return { saved: false, code: err?.code || 'PERSISTENCE_FAILED' };
	}
}
