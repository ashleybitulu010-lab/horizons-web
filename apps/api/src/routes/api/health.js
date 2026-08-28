import { APP_NAME, APP_VERSION } from '../../config/app-meta.js';
import { publicConfigSnapshot } from '../../config/env.js';

export default async function apiHealth(req, res) {
	res.json({
		status: 'ok',
		service: APP_NAME,
		version: APP_VERSION,
		timestamp: new Date().toISOString(),
		checks: {
			runtime: 'ok',
		},
		config: publicConfigSnapshot(),
	});
}
