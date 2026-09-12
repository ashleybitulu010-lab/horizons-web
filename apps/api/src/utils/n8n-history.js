import logger from './logger.js';

function readN8nWebhookUrl() {
	return process.env.N8N_CHAT_WEBHOOK || process.env.N8N_WEBHOOK_URL;
}

function readN8nApiKey() {
	return process.env.N8N_CHAT_API_KEY;
}

function n8nHeaders() {
	const apiKey = readN8nApiKey();
	return {
		'Content-Type': 'application/json',
		Accept: 'application/json',
		...(apiKey ? { 'x-api-key': apiKey } : {}),
	};
}

function normalizeHistoryMessages(data) {
	if (!data) return [];

	const raw = data.messages
		?? data.history
		?? data.thread
		?? (Array.isArray(data) ? data : []);

	if (!Array.isArray(raw)) return [];

	const messages = raw
		.filter((entry) => entry && (entry.content || entry.message))
		.map((entry, index) => ({
			id: entry.id || `msg-${index}`,
			role: entry.role === 'user' ? 'user' : 'assistant',
			content: String(entry.content || entry.message || ''),
			timestamp: entry.timestamp || entry.created_at || entry.time || null,
		}));

	return messages.sort((a, b) => {
		if (!a.timestamp && !b.timestamp) return 0;
		if (!a.timestamp) return 1;
		if (!b.timestamp) return -1;
		return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
	});
}

/** @type {((userId: string) => Promise<{ messages: object[] }>) | null} */
let fetchN8nHistoryImpl = null;

export function setFetchN8nHistoryImplForTests(impl) {
	fetchN8nHistoryImpl = impl;
}

export function resetFetchN8nHistoryImplForTests() {
	fetchN8nHistoryImpl = null;
}

/**
 * Fetch chat history from the main n8n webhook (`action: history`).
 */
export async function fetchN8nHistory(userId) {
	if (fetchN8nHistoryImpl) {
		return fetchN8nHistoryImpl(userId);
	}

	const webhookUrl = readN8nWebhookUrl();
	if (!webhookUrl) {
		throw new Error('N8N_WEBHOOK_URL is not set in apps/api/.env');
	}

	const upstream = await fetch(webhookUrl, {
		method: 'POST',
		headers: n8nHeaders(),
		body: JSON.stringify({ action: 'history', user_id: userId }),
	});

	logger.info(`n8n history status: ${upstream.status} ${upstream.statusText}`);

	if (!upstream.ok) {
		throw new Error(`n8n history failed: ${upstream.status} ${upstream.statusText}`);
	}

	const rawBody = await upstream.text();
	if (!rawBody || !rawBody.trim()) {
		return { messages: [] };
	}

	let data;
	try {
		data = JSON.parse(rawBody);
	} catch {
		logger.warn('n8n history non-JSON response');
		return { messages: [] };
	}

	return { messages: normalizeHistoryMessages(data) };
}
