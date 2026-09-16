import { createAshyAgent } from '../../agent/index.js';
import logger from '../../utils/logger.js';
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

	await persistAshyUserMessage(req.user, trimmedMessage);

	try {
		const agent = createAshyAgent();
		const result = await agent.run({
			message: trimmedMessage,
			user: req.user,
			sessionId: sessionId || req.user.businessUserId || req.user.id,
		});

		await persistAshyAssistantMessage(req.user, result.reply, result.toolResults);

		return res.json(buildAshyChatPayload(result));
	} catch (err) {
		logger.warn('[ashy-chat] agent.run failed', {
			code: err?.code || 'AGENT_RUN_FAILED',
			userId: req.user?.id,
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
