import { createAshyAgent } from '../../agent/index.js';
import logger from '../../utils/logger.js';
import { inferReadCapabilityFromMessage } from '../../observability/read-capability-inference.js';
import {
	createReadRoutingCorrelationId,
	recordReadRoutingEvent,
	READ_ROUTING_OUTCOME,
	recordV2AshyChatRouting,
} from '../../observability/read-routing-observability.js';
import {
	persistAshyAssistantMessage,
	persistAshyUserMessage,
} from './ashy-chat-persistence.js';

function buildAshyChatPayload(result) {
	const payload = {
		reply: result.reply,
		conversation: result.conversation,
		toolResults: result.toolResults,
	};
	if (result.v2Http) {
		payload.v2Http = result.v2Http;
	}
	if (result.v2Http || result.noN8nFallback === true || result.fallbackPolicy) {
		payload.noN8nFallback = result.noN8nFallback === true;
		payload.fallbackPolicy = result.fallbackPolicy || result.v2Http?.fallbackPolicy || null;
	}
	if (result.cutoverMode) {
		payload.cutoverMode = result.cutoverMode;
	}
	if (result.primaryPath) {
		payload.primaryPath = result.primaryPath;
	}
	return payload;
}

function readCorrelationId(req) {
	return req.get('x-ash-read-correlation')
		|| req.get('X-Ash-Read-Correlation')
		|| createReadRoutingCorrelationId();
}

export default async function ashyChat(req, res) {
	const { message, sessionId } = req.body ?? {};

	if (!message || typeof message !== 'string' || !message.trim()) {
		return res.status(422).json({
			error: {
				code: 'INVALID_MESSAGE',
				message: 'message is required',
			},
			noN8nFallback: false,
			fallbackPolicy: 'SAFE_FALLBACK',
		});
	}

	const trimmedMessage = message.trim();
	const correlationId = readCorrelationId(req);
	res.setHeader('X-Ash-Read-Correlation', correlationId);

	await persistAshyUserMessage(req.user, trimmedMessage);

	const startedAt = Date.now();
	try {
		const agent = createAshyAgent();
		const result = await agent.run({
			message: trimmedMessage,
			user: req.user,
			sessionId: sessionId || req.user.businessUserId || req.user.id,
		});

		await persistAshyAssistantMessage(req.user, result.reply, result.toolResults);

		recordV2AshyChatRouting({
			result,
			latencyMs: Date.now() - startedAt,
			correlationId,
			httpStatus: 200,
		});

		return res.json(buildAshyChatPayload(result));
	} catch (err) {
		logger.warn('[ashy-chat] agent.run failed', {
			code: err?.code || 'AGENT_RUN_FAILED',
			userId: req.user?.id,
		});
		recordReadRoutingEvent({
			route: 'READ',
			capability: inferReadCapabilityFromMessage(trimmedMessage),
			primaryPath: 'V2_HTTP',
			outcome: READ_ROUTING_OUTCOME.READ_V2_ERROR,
			fallback: false,
			latencyMs: Date.now() - startedAt,
			correlationId,
			goalType: 'QUESTION',
			httpStatus: 500,
			errorCode: err?.code || 'AGENT_RUN_FAILED',
		});
		return res.status(500).json({
			error: {
				code: err?.code || 'AGENT_RUN_FAILED',
				message: 'Je n’ai pas pu traiter cette demande.',
			},
			reply: 'Je n’ai pas pu traiter cette demande. Réessaie dans un instant.',
			noN8nFallback: false,
			fallbackPolicy: 'SAFE_FALLBACK',
		});
	}
}
