import logger from '../utils/logger.js';
import { fetchN8nHistory } from '../utils/n8n-history.js';
import { buildN8nSaveMessagePayload } from '../utils/n8n-proxy.js';
import {
	buildGetThreadResponse,
	buildSaveMessageResponse,
} from '../utils/thread-remote.js';

function readGetThreadWebhook() {
	return process.env.N8N_GET_THREAD_WEBHOOK;
}

function readSaveMessageWebhook() {
	return process.env.N8N_SAVE_MESSAGE_WEBHOOK;
}

function readN8nApiKey() {
	return process.env.N8N_CHAT_API_KEY;
}

function n8nHeaders() {
	const apiKey = readN8nApiKey();
	return {
		'Content-Type': 'application/json',
		'Accept': 'application/json',
		...(apiKey ? { 'x-api-key': apiKey } : {}),
	};
}

export async function getThread(req, res) {
	const trustedUserId = req.user.businessUserId || req.user.id;
	if (!trustedUserId) return res.status(422).json({ error: 'user identity is unavailable' });

	const getThreadWebhook = readGetThreadWebhook();
	if (!getThreadWebhook) {
		const { messages } = await fetchN8nHistory(trustedUserId);
		return res.json(buildGetThreadResponse(messages, { source: 'n8n_history_fallback' }));
	}

	const upstream = await fetch(getThreadWebhook, {
		method: 'POST',
		headers: n8nHeaders(),
		body: JSON.stringify({ userId: trustedUserId }),
	});

	const rawBody = await upstream.text();
	logger.info(`n8n getThread status: ${upstream.status} ${upstream.statusText}`);

	if (!upstream.ok) {
		throw new Error(`n8n getThread failed: ${upstream.status} ${upstream.statusText}`);
	}

	if (!rawBody || !rawBody.trim()) {
		return res.json(buildGetThreadResponse([]));
	}

	let data;
	try {
		data = JSON.parse(rawBody);
	} catch {
		logger.warn('n8n getThread non-JSON response');
		return res.json(buildGetThreadResponse([]));
	}

	const messages = data.messages ?? data.thread ?? (Array.isArray(data) ? data : []);
	res.json(buildGetThreadResponse(messages));
}

export async function saveMessage(req, res) {
	const { role, content } = req.body ?? {};
	const user = req.user;
	const trustedUserId = user.businessUserId || user.id;

	if (!trustedUserId || !role || !content) {
		return res.status(422).json({ error: 'user identity, role, and content are required' });
	}

	if (!readSaveMessageWebhook()) {
		return res.json(buildSaveMessageResponse({
			remoteSaved: false,
			reason: 'webhook_not_configured',
		}));
	}

	const upstream = await fetch(readSaveMessageWebhook(), {
		method: 'POST',
		headers: n8nHeaders(),
		body: JSON.stringify(buildN8nSaveMessagePayload(req)),
	});

	logger.info(`n8n saveMessage status: ${upstream.status} ${upstream.statusText}`);

	if (!upstream.ok) {
		throw new Error(`n8n saveMessage failed: ${upstream.status} ${upstream.statusText}`);
	}

	res.json(buildSaveMessageResponse({ remoteSaved: true }));
}
