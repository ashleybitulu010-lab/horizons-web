import { pingSupabase } from '../../supabase/ping.js';

export default async function supabaseStatus(req, res) {
	const result = await pingSupabase();

	res.status(result.ok ? 200 : 503).json({
		status: result.ok ? 'ok' : 'error',
		supabase: {
			configured: result.configured,
			connected: result.ok,
			latencyMs: result.latencyMs ?? null,
			...(result.error ? { error: result.error } : {}),
			...(result.code ? { code: result.code } : {}),
		},
	});
}
