import { getEnv, isProduction, publicConfigSnapshot } from '../config/env.js';

export default function requireInternalHealthKey(req, res, next) {
	const env = getEnv();

	if (!env.ashInternalHealthKey) {
		if (isProduction(env)) {
			return res.status(503).json({
				error: 'Internal health key is not configured on this server',
			});
		}
		return next();
	}

	const provided = req.get('x-ash-internal-key') || req.get('X-Ash-Internal-Key');

	if (provided !== env.ashInternalHealthKey) {
		return res.status(401).json({ error: 'Unauthorized' });
	}

	return next();
}
