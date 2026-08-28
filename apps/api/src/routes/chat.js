import logger from '../utils/logger.js';

const N8N_WEBHOOK_URL = process.env.N8N_CHAT_WEBHOOK || process.env.N8N_WEBHOOK_URL;
const N8N_API_KEY = process.env.N8N_CHAT_API_KEY;

export default async (req, res) => {
	const { message, sessionId, firstName, lastName, email } = req.body ?? {};
	const user = req.user;

	if (!message || typeof message !== 'string' || !message.trim()) {
		return res.status(422).json({ error: 'message is required' });
	}

	if (!N8N_WEBHOOK_URL) {
		throw new Error('N8N_WEBHOOK_URL is not set in apps/api/.env');
	}

	const trustedUserId = user.businessUserId || user.id;
	const trustedFirstName = user.firstName || firstName || '';
	const trustedLastName = user.lastName || lastName || '';
	const trustedEmail = user.email || email || '';

	const upstream = await fetch(N8N_WEBHOOK_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json',
			'User-Agent': 'AshLedger/1.0',
			...(N8N_API_KEY ? { 'x-api-key': N8N_API_KEY } : {}),
		},
		body: JSON.stringify({
			message: message.trim(),
			chatInput: message.trim(),
			sessionId: sessionId || trustedUserId || 'default',
			userId: trustedUserId,
			pbUserId: user.id,
			firstName: trustedFirstName,
			lastName: trustedLastName,
			email: trustedEmail,
		}),
	});

	const rawBody = await upstream.text();
	logger.info(`n8n response status: ${upstream.status} ${upstream.statusText}`);
	logger.info(`n8n response body: ${rawBody}`);

	if (!upstream.ok) {
		logger.error(`n8n webhook error: ${upstream.status} ${upstream.statusText} — body: ${rawBody}`);
		throw new Error(`n8n webhook failed: ${upstream.status} ${upstream.statusText}`);
	}

	let reply = '';

	if (rawBody && rawBody.trim()) {
		const contentType = upstream.headers.get('content-type') || '';
		if (contentType.includes('application/json') || rawBody.trim().startsWith('{') || rawBody.trim().startsWith('[')) {
			try {
				const data = JSON.parse(rawBody);
				reply =
					data.output ??
					data.reply ??
					data.text ??
					data.message ??
					data.answer ??
					data.response ??
					(Array.isArray(data) && data[0]?.output) ??
					(typeof data === 'string' ? data : null);
				if (!reply) {
					logger.warn(`n8n JSON response missing expected fields: ${rawBody}`);
					reply = "Je n'ai pas reçu de réponse compréhensible de l'agent.";
				}
			} catch (parseErr) {
				logger.warn(`n8n response is not valid JSON: ${rawBody}`);
				reply = rawBody.trim();
			}
		} else {
			reply = rawBody.trim();
		}
	} else {
		logger.warn('n8n returned an empty response body');
		reply = "L'agent n'a pas renvoyé de réponse. Veuillez réessayer.";
	}

	res.json({ reply: typeof reply === 'string' ? reply : String(reply) });
};
