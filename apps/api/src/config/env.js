import { NodeEnv } from '../constants/common.js';

const DEFAULT_SUPABASE_URL = 'https://knrwplidgvuvjnuqqmrt.supabase.co';
const DEFAULT_POCKETBASE_URL = 'http://localhost:8090';

export function getEnv() {
	return {
		nodeEnv: process.env.NODE_ENV || NodeEnv.Development,
		port: Number(process.env.PORT || 3001),
		corsOrigin: process.env.CORS_ORIGIN || null,
		pocketbaseUrl: process.env.POCKETBASE_URL || DEFAULT_POCKETBASE_URL,
		supabaseUrl: process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
		supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
		ashInternalHealthKey: process.env.ASH_INTERNAL_HEALTH_KEY || '',
		n8nChatWebhook: process.env.N8N_CHAT_WEBHOOK || process.env.N8N_WEBHOOK_URL || '',
	};
}

export function isSupabaseConfigured(env = getEnv()) {
	return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}

export function isProduction(env = getEnv()) {
	return env.nodeEnv === NodeEnv.Production;
}

/** Safe snapshot for health endpoints — never includes secrets. */
export function publicConfigSnapshot(env = getEnv()) {
	return {
		nodeEnv: env.nodeEnv,
		supabaseConfigured: isSupabaseConfigured(env),
		n8nChatConfigured: Boolean(env.n8nChatWebhook),
		internalHealthKeyConfigured: Boolean(env.ashInternalHealthKey),
	};
}
