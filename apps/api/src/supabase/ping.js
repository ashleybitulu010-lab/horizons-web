import { getSupabaseAdmin } from './client.js';
import { isSupabaseConfigured } from '../config/env.js';

/**
 * Lightweight connectivity check — no business rows returned.
 */
export async function pingSupabase() {
	if (!isSupabaseConfigured()) {
		return {
			ok: false,
			configured: false,
			error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing',
		};
	}

	const admin = getSupabaseAdmin();
	if (!admin) {
		return {
			ok: false,
			configured: true,
			error: 'Supabase admin client unavailable',
		};
	}

	const started = Date.now();

	try {
		const { error } = await admin.from('clients').select('id', {
			head: true,
			count: 'exact',
		});

		if (error) {
			return {
				ok: false,
				configured: true,
				latencyMs: Date.now() - started,
				error: error.message,
				code: error.code || null,
			};
		}

		return {
			ok: true,
			configured: true,
			latencyMs: Date.now() - started,
		};
	} catch (err) {
		return {
			ok: false,
			configured: true,
			latencyMs: Date.now() - started,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
