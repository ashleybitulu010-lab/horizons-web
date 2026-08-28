import logger from '../utils/logger.js';

const SENSITIVE_KEYS = new Set([
	'authorization',
	'token',
	'password',
	'cookie',
	'secret',
	'service_role',
]);

function sanitizeMeta(meta = {}) {
	const safe = {};
	for (const [key, value] of Object.entries(meta)) {
		if (SENSITIVE_KEYS.has(String(key).toLowerCase())) continue;
		if (typeof value === 'string' && value.length > 120) {
			safe[key] = `${value.slice(0, 40)}…`;
			continue;
		}
		safe[key] = value;
	}
	return safe;
}

export function logAuthEvent(event, meta = {}) {
	logger.info('[AUTH]', event, sanitizeMeta(meta));
}
