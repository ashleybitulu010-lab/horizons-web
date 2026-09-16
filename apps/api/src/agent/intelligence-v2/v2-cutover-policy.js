import { getEnv } from '../../config/env.js';
import { getIntelligenceV2Config } from './config.js';
import { resolveV2FallbackPolicy } from './v2-fallback-policy.js';

/** Explicit cutover modes for progressive Legacy → V2 migration (H6). */
export const CUTOVER_MODE = Object.freeze({
	LEGACY_ONLY: 'LEGACY_ONLY',
	V2_SHADOW: 'V2_SHADOW',
	V2_PRIMARY: 'V2_PRIMARY',
	V2_PRIMARY_SAFE_FALLBACK: 'V2_PRIMARY_SAFE_FALLBACK',
});

const CUTOVER_MODE_ALIASES = Object.freeze({
	LEGACY: CUTOVER_MODE.LEGACY_ONLY,
	LEGACY_ONLY: CUTOVER_MODE.LEGACY_ONLY,
	V2_SHADOW: CUTOVER_MODE.V2_SHADOW,
	SHADOW: CUTOVER_MODE.V2_SHADOW,
	V2_PRIMARY: CUTOVER_MODE.V2_PRIMARY,
	PRIMARY: CUTOVER_MODE.V2_PRIMARY,
	V2_PRIMARY_SAFE_FALLBACK: CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK,
	PRIMARY_SAFE_FALLBACK: CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK,
	SAFE_FALLBACK: CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK,
});

export const V2_PRIMARY_UNHANDLED_REPLY =
	'Je n\'ai pas pu traiter cette demande avec le moteur Ashy actuel. '
	+ 'Reformule ta question ou réessaie dans un instant.';

function normalizeCutoverModeToken(value) {
	if (!value || typeof value !== 'string') return null;
	const token = value.trim().toUpperCase().replace(/-/g, '_');
	return CUTOVER_MODE_ALIASES[token] || null;
}

/**
 * Derive cutover mode from env flags. Explicit ASHY_V2_CUTOVER_MODE wins when valid.
 * Production-safe default: LEGACY_ONLY when V2 is off or ambiguous.
 */
export function resolveCutoverMode(env = getEnv()) {
	const explicit = normalizeCutoverModeToken(env.ashyV2CutoverMode);
	if (explicit) {
		return explicit;
	}

	const config = getIntelligenceV2Config(env);
	if (!config.enabled) {
		return CUTOVER_MODE.LEGACY_ONLY;
	}

	if (config.httpEnabled && env.ashyIntelligenceV2Primary === true) {
		if (env.ashyV2PrimarySafeFallback === true) {
			return CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK;
		}
		return CUTOVER_MODE.V2_PRIMARY;
	}

	if (config.shadow && !config.httpEnabled) {
		return CUTOVER_MODE.V2_SHADOW;
	}

	return CUTOVER_MODE.LEGACY_ONLY;
}

/** Flag bundle for a cutover mode (documentation + tests; does not mutate process.env). */
export function mapFlagsForCutoverMode(mode) {
	switch (mode) {
	case CUTOVER_MODE.V2_SHADOW:
		return {
			ASHY_INTELLIGENCE_V2: true,
			ASHY_INTELLIGENCE_V2_HTTP: false,
			ASHY_INTELLIGENCE_V2_SHADOW: true,
			ASHY_INTELLIGENCE_V2_PRIMARY: false,
		};
	case CUTOVER_MODE.V2_PRIMARY:
		return {
			ASHY_INTELLIGENCE_V2: true,
			ASHY_INTELLIGENCE_V2_HTTP: true,
			ASHY_INTELLIGENCE_V2_SHADOW: false,
			ASHY_INTELLIGENCE_V2_PRIMARY: true,
			ASHY_V2_PRIMARY_SAFE_FALLBACK: false,
		};
	case CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK:
		return {
			ASHY_INTELLIGENCE_V2: true,
			ASHY_INTELLIGENCE_V2_HTTP: true,
			ASHY_INTELLIGENCE_V2_SHADOW: false,
			ASHY_INTELLIGENCE_V2_PRIMARY: true,
			ASHY_V2_PRIMARY_SAFE_FALLBACK: true,
		};
	default:
		return {
			ASHY_INTELLIGENCE_V2: false,
			ASHY_INTELLIGENCE_V2_HTTP: false,
			ASHY_INTELLIGENCE_V2_SHADOW: false,
			ASHY_INTELLIGENCE_V2_PRIMARY: false,
		};
	}
}

export function isV2PrimaryMode(mode) {
	return mode === CUTOVER_MODE.V2_PRIMARY
		|| mode === CUTOVER_MODE.V2_PRIMARY_SAFE_FALLBACK;
}

export function isLegacyPrimaryMode(mode) {
	return mode === CUTOVER_MODE.LEGACY_ONLY || mode === CUTOVER_MODE.V2_SHADOW;
}

/** When true, agent.run must not silently fall through to Legacy after V2 HTTP declines the turn. */
export function shouldBlockLegacyPassthrough(mode) {
	return isV2PrimaryMode(mode);
}

/** Shadow observes Legacy only in V2_SHADOW mode — never on V2 primary or duplicate V2 HTTP turns. */
export function shouldRunShadowObservation(mode, { v2HttpHandled = false } = {}) {
	if (isV2PrimaryMode(mode) || v2HttpHandled) {
		return false;
	}
	return mode === CUTOVER_MODE.V2_SHADOW;
}

export function resolvePrimaryPath(mode, { v2HttpHandled = false } = {}) {
	if (v2HttpHandled) return 'V2_HTTP';
	if (isV2PrimaryMode(mode)) return 'V2_PRIMARY_UNHANDLED';
	if (mode === CUTOVER_MODE.V2_SHADOW) return 'LEGACY_WITH_SHADOW';
	return 'LEGACY';
}

function inferUnhandledGoalType({ previousState = {}, message = '' } = {}) {
	if (previousState?.pendingWrite) return 'ACTION';
	const text = String(message || '').trim();
	if (/^(?:oui|yes|ok|confirme)\b/i.test(text)) return 'ACTION';
	if (/\b(?:vendu|vente|d[eé]pense|ajoute)\b/i.test(text)) return 'ACTION';
	return 'QUESTION';
}

/**
 * Build agent response when V2 primary is active but HTTP handler returned handled=false.
 */
export function buildV2PrimaryUnhandledAgentResponse({
	cutoverMode,
	message = '',
	previousState = {},
	user = null,
}) {
	const goalType = inferUnhandledGoalType({ previousState, message });
	const mode = goalType === 'ACTION' ? 'action_proposal' : null;
	const baseV2Http = {
		handled: false,
		source: 'v2_http',
		primaryPath: 'V2_PRIMARY_UNHANDLED',
		cutoverMode,
		goalType,
		mode,
		code: 'V2_PRIMARY_UNHANDLED',
	};
	const resolved = resolveV2FallbackPolicy(baseV2Http, { cutoverMode });
	const v2Http = {
		...baseV2Http,
		noN8nFallback: resolved.noN8nFallback,
		fallbackPolicy: resolved.policy,
		fallbackReason: resolved.reason,
	};

	return {
		reply: V2_PRIMARY_UNHANDLED_REPLY,
		conversation: previousState ? {
			topic: previousState.topic,
			intent: previousState.intent,
			filters: previousState.filters,
			references: previousState.references,
			lastTool: previousState.lastTool,
			lastAction: previousState.lastAction,
			updatedAt: previousState.updatedAt,
		} : null,
		toolResults: [],
		intentDiagnostics: null,
		v2Http,
		noN8nFallback: v2Http?.noN8nFallback === true,
		fallbackPolicy: v2Http?.fallbackPolicy || null,
		cutoverMode,
		primaryPath: 'V2_PRIMARY_UNHANDLED',
	};
}

export function getCutoverDiagnostics(env = getEnv()) {
	const mode = resolveCutoverMode(env);
	const config = getIntelligenceV2Config(env);
	return {
		cutoverMode: mode,
		primaryPath: resolvePrimaryPath(mode),
		v2Enabled: config.enabled,
		v2Http: config.httpEnabled,
		v2Shadow: config.shadow,
		v2Primary: env.ashyIntelligenceV2Primary === true,
		v2PrimarySafeFallback: env.ashyV2PrimarySafeFallback === true,
		blockLegacyPassthrough: shouldBlockLegacyPassthrough(mode),
	};
}

/** Ensures absent/malformed env cannot accidentally enable V2 primary in production. */
export function validateCutoverConfigSafety(env = getEnv()) {
	const issues = [];
	const config = getIntelligenceV2Config(env);

	if (env.ashyIntelligenceV2Primary === true && !config.enabled) {
		issues.push('ASHY_INTELLIGENCE_V2_PRIMARY requires ASHY_INTELLIGENCE_V2=true');
	}
	if (env.ashyIntelligenceV2Primary === true && !config.httpEnabled) {
		issues.push('ASHY_INTELLIGENCE_V2_PRIMARY requires ASHY_INTELLIGENCE_V2_HTTP=true');
	}
	if (env.ashyV2PrimarySafeFallback === true && env.ashyIntelligenceV2Primary !== true) {
		issues.push('ASHY_V2_PRIMARY_SAFE_FALLBACK requires ASHY_INTELLIGENCE_V2_PRIMARY=true');
	}

	const mode = resolveCutoverMode(env);
	if (isV2PrimaryMode(mode) && (!config.enabled || !config.httpEnabled)) {
		issues.push('V2 primary mode requires V2 + HTTP enabled');
	}

	return {
		safe: issues.length === 0,
		issues,
		mode,
		productionDefaultLegacy: env.ashyIntelligenceV2Primary !== true,
	};
}
