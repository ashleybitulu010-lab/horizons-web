import { createAshyAgent } from '../../agent/index.js';
import {
	persistAshyAssistantMessage,
	persistAshyUserMessage,
} from './ashy-chat-persistence.js';

export default async function ashyChat(req, res) {
	const { message, sessionId } = req.body ?? {};

	if (!message || typeof message !== 'string' || !message.trim()) {
		return res.status(422).json({
			error: {
				code: 'INVALID_MESSAGE',
				message: 'message is required',
			},
		});
	}

	const trimmedMessage = message.trim();

	await persistAshyUserMessage(req.user, trimmedMessage);

	const agent = createAshyAgent();
	const result = await agent.run({
		message: trimmedMessage,
		user: req.user,
		sessionId: sessionId || req.user.businessUserId || req.user.id,
	});

	await persistAshyAssistantMessage(req.user, result.reply, result.toolResults);

	res.json({
		reply: result.reply,
		conversation: result.conversation,
		toolResults: result.toolResults,
	});
}
