import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

import { getEnv, isSupabaseConfigured } from '../config/env.js';

let adminClient = null;

/**
 * Server-side Supabase client (service role). Never expose to the browser.
 */
export function getSupabaseAdmin() {
	if (!isSupabaseConfigured()) {
		return null;
	}

	if (!adminClient) {
		const env = getEnv();
		adminClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
			auth: {
				autoRefreshToken: false,
				persistSession: false,
			},
			realtime: { transport: ws },
		});
	}

	return adminClient;
}

export function resetSupabaseAdminForTests() {
	adminClient = null;
}
