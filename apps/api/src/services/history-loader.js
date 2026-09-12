import { listMessages } from './conversation-service.js';
import { fetchN8nHistory } from '../utils/n8n-history.js';
import { mapSupabaseMessagesToHistoryDto } from '../utils/history-mapper.js';
import { mergeHistorySources } from '../utils/history-merge.js';
import logger from '../utils/logger.js';

export class HistoryUnavailableError extends Error {
	constructor(message = 'Chat history is temporarily unavailable') {
		super(message);
		this.name = 'HistoryUnavailableError';
		this.code = 'HISTORY_UNAVAILABLE';
	}
}

function logSupabaseReadFailure(err, user) {
	logger.warn('[history] supabase read failed', {
		code: err?.code || 'UNKNOWN',
		userId: user?.id,
	});
}

function logN8nReadFailure(err, user) {
	logger.warn('[history] n8n read failed', {
		userId: user?.id,
	});
}

async function loadSupabaseHistory(user) {
	if (!user?.clientId) {
		return { messages: [], attempted: false, error: null };
	}

	try {
		const { messages } = await listMessages({ user });
		return {
			messages: mapSupabaseMessagesToHistoryDto(messages),
			attempted: true,
			error: null,
		};
	} catch (err) {
		logSupabaseReadFailure(err, user);
		return { messages: [], attempted: true, error: err };
	}
}

async function loadN8nHistory(user) {
	const trustedUserId = user.businessUserId || user.id;
	try {
		const { messages } = await fetchN8nHistory(trustedUserId);
		return { messages: messages || [], error: null };
	} catch (err) {
		logN8nReadFailure(err, user);
		return { messages: [], error: err };
	}
}

/**
 * Resolve chat history for POST /history.
 * Supabase chat_messages is primary; n8n is fallback / merge partner.
 */
export async function resolveChatHistory(user) {
	const supabase = await loadSupabaseHistory(user);
	const n8n = await loadN8nHistory(user);

	const hasSupabase = supabase.messages.length > 0;
	const hasN8n = n8n.messages.length > 0;

	if (hasSupabase && !hasN8n) {
		return { messages: supabase.messages, source: 'supabase' };
	}

	if (!hasSupabase && hasN8n) {
		return { messages: n8n.messages, source: 'n8n_history' };
	}

	if (hasSupabase && hasN8n) {
		return {
			messages: mergeHistorySources(supabase.messages, n8n.messages),
			source: 'merged',
		};
	}

	if (!hasSupabase && !hasN8n) {
		if (n8n.error || (supabase.attempted && supabase.error)) {
			throw new HistoryUnavailableError();
		}

		if (supabase.attempted) {
			return { messages: [], source: 'supabase' };
		}

		return { messages: [], source: 'n8n_history' };
	}

	return { messages: [], source: 'n8n_history' };
}
