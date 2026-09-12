import { getSupabaseAdmin } from '../supabase/client.js';
import { isSupabaseConfigured } from '../config/env.js';
import { requireClientScope } from './supabase-scoped.js';

export const ACTIVITY_SCOPE_HEADER = 'X-Activity-Id';

let resolveDefaultActivityImpl = null;
let validateActivityForClientImpl = null;

export function setResolveDefaultActivityImplForTests(impl) {
	resolveDefaultActivityImpl = impl;
}

export function setValidateActivityForClientImplForTests(impl) {
	validateActivityForClientImpl = impl;
}

export function resetActivityScopeImplForTests() {
	resolveDefaultActivityImpl = null;
	validateActivityForClientImpl = null;
}

function activityScopeError(code, message) {
	const error = new Error(message);
	error.code = code;
	return error;
}

async function defaultResolveDefaultActivity(clientId) {
	if (!isSupabaseConfigured()) {
		throw activityScopeError('SUPABASE_NOT_CONFIGURED', 'Supabase is not configured');
	}

	const admin = getSupabaseAdmin();
	if (!admin) {
		throw activityScopeError('SUPABASE_NOT_CONFIGURED', 'Supabase admin client unavailable');
	}

	const { data, error } = await admin
		.from('activities')
		.select('id, client_id, name, type, is_default')
		.eq('client_id', clientId)
		.eq('is_default', true)
		.limit(1)
		.maybeSingle();

	if (error) {
		throw activityScopeError('ACTIVITY_LOOKUP_FAILED', 'Unable to resolve default activity');
	}

	if (!data?.id) {
		throw activityScopeError('DEFAULT_ACTIVITY_MISSING', 'No default activity for client');
	}

	return {
		id: data.id,
		clientId: data.client_id,
		name: data.name,
		type: data.type,
		isDefault: Boolean(data.is_default),
	};
}

async function defaultValidateActivityForClient(clientId, activityId) {
	if (!activityId) {
		throw activityScopeError('ACTIVITY_ID_REQUIRED', 'activity_id is required');
	}

	if (!isSupabaseConfigured()) {
		throw activityScopeError('SUPABASE_NOT_CONFIGURED', 'Supabase is not configured');
	}

	const admin = getSupabaseAdmin();
	if (!admin) {
		throw activityScopeError('SUPABASE_NOT_CONFIGURED', 'Supabase admin client unavailable');
	}

	const { data, error } = await admin
		.from('activities')
		.select('id, client_id, name, type, is_default')
		.eq('id', activityId)
		.maybeSingle();

	if (error) {
		throw activityScopeError('ACTIVITY_LOOKUP_FAILED', 'Unable to validate activity');
	}

	if (!data || data.client_id !== clientId) {
		throw activityScopeError('ACTIVITY_OWNERSHIP_VIOLATION', 'Activity does not belong to client');
	}

	return {
		id: data.id,
		clientId: data.client_id,
		name: data.name,
		type: data.type,
		isDefault: Boolean(data.is_default),
	};
}

export async function resolveDefaultActivity(clientId) {
	const resolver = resolveDefaultActivityImpl || defaultResolveDefaultActivity;
	return resolver(clientId);
}

export async function validateActivityForClient(clientId, activityId) {
	const validator = validateActivityForClientImpl || defaultValidateActivityForClient;
	return validator(clientId, activityId);
}

function normalizeExplicitActivityId(value) {
	if (value == null) return null;
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed || null;
}

export function extractExplicitActivityId(req) {
	if (!req) return null;

	const headerValue = req.get?.(ACTIVITY_SCOPE_HEADER) || req.headers?.[ACTIVITY_SCOPE_HEADER.toLowerCase()];
	const fromHeader = normalizeExplicitActivityId(headerValue);
	if (fromHeader) return fromHeader;

	return normalizeExplicitActivityId(
		req.body?.activityId
		?? req.body?.activity_id
		?? req.query?.activityId
		?? req.query?.activity_id,
	);
}

/**
 * Resolve validated business scope for an authenticated user.
 * explicitActivityId is an optional hint (header/body/query) validated server-side.
 */
export async function resolveActivityScopeForUser(user, explicitActivityId = null) {
	const clientId = requireClientScope(user);
	const explicit = normalizeExplicitActivityId(explicitActivityId);

	if (explicit) {
		const activity = await validateActivityForClient(clientId, explicit);
		return {
			clientId,
			activityId: activity.id,
			activity,
		};
	}

	const activity = await resolveDefaultActivity(clientId);
	return {
		clientId,
		activityId: activity.id,
		activity,
	};
}

export async function attachActivityScopeToUser(user, explicitActivityId = null) {
	const scope = await resolveActivityScopeForUser(user, explicitActivityId);
	user.activeActivityId = scope.activityId;
	user.activeActivity = scope.activity;
	return scope;
}
