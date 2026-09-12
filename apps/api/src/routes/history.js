import { resolveChatHistory } from '../services/history-loader.js';
import { buildHistoryResponse } from '../utils/thread-remote.js';

export default async (req, res) => {
	const trustedUserId = req.user.businessUserId || req.user.id;

	if (!trustedUserId) {
		return res.status(422).json({ error: 'user identity is unavailable' });
	}

	const { messages, source } = await resolveChatHistory(req.user);
	res.json(buildHistoryResponse(messages, { source }));
};
