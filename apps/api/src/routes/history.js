import logger from '../utils/logger.js';

const N8N_WEBHOOK_URL = process.env.N8N_CHAT_WEBHOOK || process.env.N8N_WEBHOOK_URL;
const N8N_API_KEY = process.env.N8N_CHAT_API_KEY || process.env.N8N_CHAT_WEBHOOK_API_KEY;

export default async (req, res) => {
	const { user_id } = req.body ?? {};

	if (!user_id) {
		return res.status(422).json({ error: 'user_id is required' });
	}

	if (!N8N_WEBHOOK_URL) {
		throw new Error('N8N_WEBHOOK_URL is not set in apps/api/.env');
	}

	const upstream = await fetch(N8N_WEBHOOK_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json',
			'User-Agent': 'AshLedger/1.0',
			...(N8N_API_KEY ? { 'x-api-key': N8N_API_KEY } : {}),
		},
		body: JSON.stringify({ action: 'history', user_id }),
	});

	const rawBody = await upstream.text();
	logger.info(`history n8n status: ${upstream.status} ${upstream.statusText}`);
	logger.info(`history n8n body: ${rawBody}`);

	if (!upstream.ok) {
		throw new Error(`n8n history failed: ${upstream.status} ${upstream.statusText}`);
	}

	if (!rawBody || !rawBody.trim()) {
		return res.json({ success: true, messages: [] });
	}

	let data;
	try {
		data = JSON.parse(rawBody);
	} catch (_) {
		logger.warn(`history: non-JSON response: ${rawBody}`);
		return res.json({ success: true, messages: [] });
	}

	const messages = Array.isArray(data.messages) ? data.messages : [];
	res.json({ success: true, messages });
};
