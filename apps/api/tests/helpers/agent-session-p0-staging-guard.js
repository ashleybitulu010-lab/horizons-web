/**
 * Phase 5.8-P0-ENV-2 — Staging harness safety gate (observe-only, no Supabase I/O).
 * Requires explicit opt-in before any real Supabase integration test may run.
 */

/** Ash Ledger production — public ref from supabase/config.toml and src/config/env.js */
export const PRODUCTION_SUPABASE_PROJECT_REF = 'knrwplidgvuvjnuqqmrt';

export const STAGING_GATE_REASONS = Object.freeze({
	OK: 'OK',
	CREDENTIALS_MISSING: 'CREDENTIALS_MISSING',
	RUN_STAGING_NOT_TRUE: 'RUN_STAGING_NOT_TRUE',
	ALLOWLIST_MISSING: 'ALLOWLIST_MISSING',
	PROJECT_REF_UNPARSEABLE: 'PROJECT_REF_UNPARSEABLE',
	PROJECT_REF_NOT_ALLOWED: 'PROJECT_REF_NOT_ALLOWED',
	PRODUCTION_PROJECT_REF_BLOCKED: 'PRODUCTION_PROJECT_REF_BLOCKED',
	NODE_ENV_PRODUCTION: 'NODE_ENV_PRODUCTION',
});

/**
 * Extract Supabase project ref from URL: https://{ref}.supabase.co
 */
export function parseSupabaseProjectRef(supabaseUrl) {
	if (!supabaseUrl || typeof supabaseUrl !== 'string') {
		return null;
	}
	const match = supabaseUrl.trim().match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
	return match ? match[1].toLowerCase() : null;
}

/**
 * Build safe diagnostics — never includes secret values.
 */
export function stagingGateDiagnostics(env = process.env) {
	const supabaseUrl = env.SUPABASE_URL || '';
	const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
	const allowedRef = (env.STAGING_ALLOWED_SUPABASE_PROJECT_REF || '').trim().toLowerCase();
	const projectRef = parseSupabaseProjectRef(supabaseUrl);

	return {
		supabaseUrl: supabaseUrl ? 'PRESENT' : 'ABSENT',
		serviceRoleKey: serviceKey ? 'PRESENT' : 'ABSENT',
		runStaging: env.RUN_STAGING === 'true' ? 'true' : 'false',
		allowedProjectRef: allowedRef || 'ABSENT',
		projectRef: projectRef || 'ABSENT',
		productionProjectRef: PRODUCTION_SUPABASE_PROJECT_REF,
		nodeEnv: env.NODE_ENV || 'development',
	};
}

function isProductionProjectRef(ref) {
	return Boolean(ref && ref.toLowerCase() === PRODUCTION_SUPABASE_PROJECT_REF);
}

/**
 * All conditions required before real Supabase staging tests may run.
 */
export function evaluateStagingHarnessGate(env = process.env) {
	const diagnostics = stagingGateDiagnostics(env);
	const supabaseUrl = env.SUPABASE_URL || '';
	const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
	const allowedRef = (env.STAGING_ALLOWED_SUPABASE_PROJECT_REF || '').trim().toLowerCase();
	const projectRef = parseSupabaseProjectRef(supabaseUrl);

	if (!supabaseUrl || !serviceKey) {
		return {
			allowed: false,
			reason: STAGING_GATE_REASONS.CREDENTIALS_MISSING,
			diagnostics,
		};
	}

	if ((env.NODE_ENV || 'development') === 'production') {
		return {
			allowed: false,
			reason: STAGING_GATE_REASONS.NODE_ENV_PRODUCTION,
			diagnostics,
		};
	}

	if (isProductionProjectRef(projectRef) || isProductionProjectRef(allowedRef)) {
		return {
			allowed: false,
			reason: STAGING_GATE_REASONS.PRODUCTION_PROJECT_REF_BLOCKED,
			diagnostics,
		};
	}

	if (env.RUN_STAGING !== 'true') {
		return {
			allowed: false,
			reason: STAGING_GATE_REASONS.RUN_STAGING_NOT_TRUE,
			diagnostics,
		};
	}

	if (!allowedRef) {
		return {
			allowed: false,
			reason: STAGING_GATE_REASONS.ALLOWLIST_MISSING,
			diagnostics,
		};
	}

	if (!projectRef) {
		return {
			allowed: false,
			reason: STAGING_GATE_REASONS.PROJECT_REF_UNPARSEABLE,
			diagnostics,
		};
	}

	if (projectRef !== allowedRef) {
		return {
			allowed: false,
			reason: STAGING_GATE_REASONS.PROJECT_REF_NOT_ALLOWED,
			diagnostics,
		};
	}

	return {
		allowed: true,
		reason: STAGING_GATE_REASONS.OK,
		diagnostics,
	};
}

export function stagingHarnessSkipMessage(gate) {
	return `P0 staging harness blocked: ${gate.reason} (${JSON.stringify(gate.diagnostics)})`;
}
