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
		ledgerTimezone: process.env.ASH_LEDGER_TIMEZONE || 'Africa/Kinshasa',
		ashyLlmEnabled: process.env.ASHY_LLM_ENABLED === 'true',
		openAiApiKey: process.env.OPENAI_API_KEY || '',
		ashyLlmModel: process.env.ASHY_LLM_MODEL || 'gpt-4o-mini',
		ashyLlmBaseUrl: process.env.ASHY_LLM_BASE_URL || 'https://api.openai.com/v1',
		ashyLlmTimeoutMs: Number(process.env.ASHY_LLM_TIMEOUT_MS || 8000),
		ashyIntelligenceV2: process.env.ASHY_INTELLIGENCE_V2 === 'true',
		ashyIntelligenceV2Http: process.env.ASHY_INTELLIGENCE_V2_HTTP === 'true',
		ashyIntelligenceV2HttpConfirm: process.env.ASHY_INTELLIGENCE_V2_HTTP_CONFIRM === 'true',
		ashyIntelligenceV2Shadow: process.env.ASHY_INTELLIGENCE_V2_SHADOW === 'true',
		ashyIntelligenceV2Actions: process.env.ASHY_INTELLIGENCE_V2_ACTIONS === 'true',
		ashyIntelligenceV2Llm: process.env.ASHY_INTELLIGENCE_V2_LLM === 'true',
		ashyV2MaxConcurrency: Number(process.env.ASHY_V2_MAX_CONCURRENCY || 4),
		ashyV2StepTimeoutMs: Number(process.env.ASHY_V2_STEP_TIMEOUT_MS || 10000),
		ashyV2PlanTimeoutMs: Number(process.env.ASHY_V2_PLAN_TIMEOUT_MS || 30000),
		ashyV2ShadowTimeoutMs: Number(process.env.ASHY_INTELLIGENCE_V2_SHADOW_TIMEOUT_MS || 3000),
		ashyIntelligenceV2Primary: process.env.ASHY_INTELLIGENCE_V2_PRIMARY === 'true',
		ashyV2CutoverMode: process.env.ASHY_V2_CUTOVER_MODE || '',
		ashyV2PrimarySafeFallback: process.env.ASHY_V2_PRIMARY_SAFE_FALLBACK === 'true',
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
		ashyLlmConfigured: Boolean(env.ashyLlmEnabled && env.openAiApiKey),
	};
}
