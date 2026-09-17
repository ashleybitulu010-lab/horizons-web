import logger from '../utils/logger.js';
import { isLikelyReadMessage } from '../observability/read-capability-inference.js';
import {
	createReadRoutingCorrelationId,
	recordLegacyN8nChatRouting,
} from '../observability/read-routing-observability.js';
import {
	buildN8nChatClientResponse,
	buildN8nChatPayload,
	truncateProxyLogBody,
} from '../utils/n8n-proxy.js';
import {
	parseN8nChatUpstreamResponse,
	persistN8nAssistantMessage,
	persistN8nUserMessage,
} from '../services/n8n-chat-persistence.js';

function readN8nChatWebhookUrl() {
	return process.env.N8N_CHAT_WEBHOOK || process.env.N8N_WEBHOOK_URL;
}

function readN8nApiKey() {
	return process.env.N8N_CHAT_API_KEY;
}

function readRoutingHeaders(req) {
	const correlationId = req.get('x-ash-read-correlation')
		|| req.get('X-Ash-Read-Correlation')
		|| createReadRoutingCorrelationId();
	const fallbackMode = req.get('x-ash-read-fallback')
		|| req.get('X-Ash-Read-Fallback')
		|| null;
	return { correlationId, fallbackMode };
}

export default async (req, res) => {
	const { message } = req.body ?? {};
	const trimmedMessage = typeof message === 'string' ? message.trim() : '';

	if (!trimmedMessage) {
		return res.status(422).json({ error: 'message is required' });
	}

	const n8nWebhookUrl = readN8nChatWebhookUrl();
	if (!n8nWebhookUrl) {
		throw new Error('N8N_WEBHOOK_URL is not set in apps/api/.env');
	}

	const { correlationId, fallbackMode } = readRoutingHeaders(req);
	res.setHeader('X-Ash-Read-Correlation', correlationId);

	await persistN8nUserMessage(req.user, trimmedMessage);

	const upstreamBody = buildN8nChatPayload(req);
	const n8nApiKey = readN8nApiKey();

	const startedAt = Date.now();
	const upstream = await fetch(n8nWebhookUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json',
			'User-Agent': 'AshLedger/1.0',
			...(n8nApiKey ? { 'x-api-key': n8nApiKey } : {}),
		},
		body: JSON.stringify(upstreamBody),
	});

	const rawBody = await upstream.text();
	logger.info(`n8n response status: ${upstream.status} ${upstream.statusText}`);
	logger.info(`n8n response body: ${truncateProxyLogBody(rawBody)}`);

	if (!upstream.ok) {
		logger.error(`n8n webhook error: ${upstream.status} ${upstream.statusText} — body: ${truncateProxyLogBody(rawBody)}`);
		throw new Error(`n8n webhook failed: ${upstream.status} ${upstream.statusText}`);
	}

	const contentType = upstream.headers.get('content-type') || '';
	const { reply, parsedData, persistAssistant } = parseN8nChatUpstreamResponse(rawBody, contentType);

	if (!persistAssistant) {
		if (!rawBody || !rawBody.trim()) {
			logger.warn('n8n returned an empty response body');
		} else {
			logger.warn(`n8n JSON response missing expected fields: ${truncateProxyLogBody(rawBody)}`);
		}
	}

	if (persistAssistant) {
		await persistN8nAssistantMessage(req.user, reply, parsedData);
	}

	if (isLikelyReadMessage(trimmedMessage) || fallbackMode === 'safe-fallback') {
		recordLegacyN8nChatRouting({
			message: trimmedMessage,
			latencyMs: Date.now() - startedAt,
			correlationId,
			httpStatus: upstream.status,
			fallbackMode,
		});
	}

	res.json(buildN8nChatClientResponse(parsedData, reply));
};
