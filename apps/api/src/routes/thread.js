import logger from '../utils/logger.js';

const N8N_GET_THREAD_WEBHOOK = process.env.N8N_GET_THREAD_WEBHOOK;
const N8N_SAVE_MESSAGE_WEBHOOK = process.env.N8N_SAVE_MESSAGE_WEBHOOK;
const N8N_API_KEY = process.env.N8N_CHAT_API_KEY;

function n8nHeaders() {
	return {
		'Content-Type': 'application/json',
		'Accept': 'application/json',
		...(N8N_API_KEY ? { 'x-api-key': N8N_API_KEY } : {}),
	};
}

export async function getThread(req, res) {
	const trustedUserId = req.user.businessUserId || req.user.id;
	if (!trustedUserId) return res.status(422).json({ error: 'user identity is unavailable' });

	if (!N8N_GET_THREAD_WEBHOOK) {
		// Return empty thread if webhook not configured yet
		return res.json({ messages: [] });
	}

	const upstream = await fetch(N8N_GET_THREAD_WEBHOOK, {
		method: 'POST',
		headers: n8nHeaders(),
		body: JSON.stringify({ userId: trustedUserId }),
	});

	const rawBody = await upstream.text();
	logger.info(`n8n getThread status: ${upstream.status} ${upstream.statusText}`);
	logger.info(`n8n getThread body: ${rawBody}`);

	if (!upstream.ok) {
		throw new Error(`n8n getThread failed: ${upstream.status} ${upstream.statusText}`);
	}

	if (!rawBody || !rawBody.trim()) {
		return res.json({ messages: [] });
	}

	let data;
	try {
		data = JSON.parse(rawBody);
	} catch {
		logger.warn(`n8n getThread non-JSON response: ${rawBody}`);
		return res.json({ messages: [] });
	}

	// Normalize: accept { messages: [...] } or array of messages directly
	const messages = data.messages ?? data.thread ?? (Array.isArray(data) ? data : []);

	res.json({ messages });
}

export async function saveMessage(req, res) {
	const { role, content, timestamp, email, firstName, lastName } = req.body ?? {};
	const user = req.user;
	const trustedUserId = user.businessUserId || user.id;

	if (!trustedUserId || !role || !content) {
		return res.status(422).json({ error: 'user identity, role, and content are required' });
	}

	if (!N8N_SAVE_MESSAGE_WEBHOOK) {
		// Silently succeed if webhook not configured yet
		return res.json({ success: true });
	}

	const upstream = await fetch(N8N_SAVE_MESSAGE_WEBHOOK, {
		method: 'POST',
		headers: n8nHeaders(),
		body: JSON.stringify({
			userId: trustedUserId,
			pbUserId: user.id,
			role,
			content,
			timestamp: timestamp || new Date().toISOString(),
			email: user.email || email || '',
			firstName: user.firstName || firstName || '',
			lastName: user.lastName || lastName || '',
		}),
	});

	const rawBody = await upstream.text();
	logger.info(`n8n saveMessage status: ${upstream.status} ${upstream.statusText}`);

	if (!upstream.ok) {
		throw new Error(`n8n saveMessage failed: ${upstream.status} ${upstream.statusText}`);
	}

	res.json({ success: true });
}
