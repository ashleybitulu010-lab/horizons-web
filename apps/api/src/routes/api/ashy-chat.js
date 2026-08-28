import { createAshyAgent } from '../../agent/index.js';

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

	const agent = createAshyAgent();
	const result = await agent.run({
		message: message.trim(),
		user: req.user,
		sessionId: sessionId || req.user.businessUserId || req.user.id,
	});

	res.json({
		reply: result.reply,
		conversation: result.conversation,
		toolResults: result.toolResults,
	});
}
