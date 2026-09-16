import { getEnv } from '../../config/env.js';
import { DEFAULT_SHADOW_TIMEOUT_MS } from './shadow/shadow-contract.js';

export const DEFAULT_V2_MAX_CONCURRENCY = 4;
export const DEFAULT_V2_STEP_TIMEOUT_MS = 10_000;
export const DEFAULT_V2_PLAN_TIMEOUT_MS = 30_000;

function parsePositiveInt(value, fallback) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}
	return Math.floor(parsed);
}

export function getIntelligenceV2Config(env = getEnv()) {
	return {
		enabled: env.ashyIntelligenceV2 === true,
		httpEnabled: env.ashyIntelligenceV2Http === true,
		httpConfirmEnabled: env.ashyIntelligenceV2HttpConfirm === true,
		shadow: env.ashyIntelligenceV2Shadow === true,
		actionsEnabled: env.ashyIntelligenceV2Actions === true,
		llmClassifierEnabled: env.ashyIntelligenceV2Llm === true && Boolean(env.openAiApiKey),
	};
}

export function getExecutorConfig(env = getEnv()) {
	return {
		maxConcurrency: parsePositiveInt(env.ashyV2MaxConcurrency, DEFAULT_V2_MAX_CONCURRENCY),
		stepTimeoutMs: parsePositiveInt(env.ashyV2StepTimeoutMs, DEFAULT_V2_STEP_TIMEOUT_MS),
		planTimeoutMs: parsePositiveInt(env.ashyV2PlanTimeoutMs, DEFAULT_V2_PLAN_TIMEOUT_MS),
	};
}

export function isIntelligenceV2Enabled(env = getEnv()) {
	return getIntelligenceV2Config(env).enabled;
}

export function isIntelligenceV2ShadowEnabled(env = getEnv()) {
	const config = getIntelligenceV2Config(env);
	return config.enabled && config.shadow;
}

export function isIntelligenceV2ActionsEnabled(env = getEnv()) {
	const config = getIntelligenceV2Config(env);
	return config.enabled && config.actionsEnabled;
}

export function isIntelligenceV2HttpEnabled(env = getEnv()) {
	const config = getIntelligenceV2Config(env);
	return config.enabled && config.httpEnabled;
}

/** H3 — when false, HTTP action confirmations do not call F4-B2 (H2 proposal-only). */
export function isIntelligenceV2HttpConfirmEnabled(env = getEnv()) {
	const config = getIntelligenceV2Config(env);
	return config.enabled && config.httpEnabled && config.httpConfirmEnabled;
}

/** H5 — shadow observation timeout (ms), independent of plan timeout. */
export function getShadowConfig(env = getEnv()) {
	const config = getIntelligenceV2Config(env);
	return {
		enabled: config.enabled && config.shadow,
		shadowTimeoutMs: parsePositiveInt(
			env.ashyV2ShadowTimeoutMs ?? process.env.ASHY_INTELLIGENCE_V2_SHADOW_TIMEOUT_MS,
			DEFAULT_SHADOW_TIMEOUT_MS,
		),
	};
}

/** H6 — V2 is the primary HTTP path (requires V2 + HTTP; default off). */
export function isIntelligenceV2PrimaryEnabled(env = getEnv()) {
	const config = getIntelligenceV2Config(env);
	return config.enabled && config.httpEnabled && env.ashyIntelligenceV2Primary === true;
}
