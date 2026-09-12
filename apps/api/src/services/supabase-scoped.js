import { sendForbidden } from '../utils/auth-errors.js';

/**
 * When using the Supabase service role, RLS is bypassed.
 * Every query must be scoped explicitly with the authenticated user context.
 */
export function requireClientScope(user) {
	if (!user?.clientId) {
		const error = new Error('SUPABASE_CLIENT_SCOPE_MISSING');
		error.code = 'SUPABASE_CLIENT_SCOPE_MISSING';
		throw error;
	}
	return user.clientId;
}

export function requireActivityScope(user) {
	if (!user?.activeActivityId) {
		const error = new Error('SUPABASE_ACTIVITY_SCOPE_MISSING');
		error.code = 'SUPABASE_ACTIVITY_SCOPE_MISSING';
		throw error;
	}
	return user.activeActivityId;
}

export function getBusinessScope(user) {
	return {
		clientId: requireClientScope(user),
		activityId: requireActivityScope(user),
	};
}

export function assertClientOwnership(user, clientId) {
	if (!user?.clientId || !clientId || user.clientId !== clientId) {
		const error = new Error('CLIENT_OWNERSHIP_VIOLATION');
		error.code = 'CLIENT_OWNERSHIP_VIOLATION';
		throw error;
	}
}

export function assertActivityOwnership(user, activityId) {
	if (!user?.activeActivityId || !activityId || user.activeActivityId !== activityId) {
		const error = new Error('ACTIVITY_OWNERSHIP_VIOLATION');
		error.code = 'ACTIVITY_OWNERSHIP_VIOLATION';
		throw error;
	}
}

export function applyClientFilter(query, user) {
	const clientId = requireClientScope(user);
	return query.eq('client_id', clientId);
}

export function applyBusinessScopeFilter(query, user) {
	const { clientId, activityId } = getBusinessScope(user);
	return query.eq('client_id', clientId).eq('activity_id', activityId);
}

export function handleScopeError(res, err) {
	if (err?.code === 'CLIENT_OWNERSHIP_VIOLATION' || err?.code === 'SUPABASE_CLIENT_SCOPE_MISSING') {
		return sendForbidden(res, 'Access denied for this client scope');
	}
	if (err?.code === 'ACTIVITY_OWNERSHIP_VIOLATION' || err?.code === 'SUPABASE_ACTIVITY_SCOPE_MISSING') {
		return sendForbidden(res, 'Access denied for this activity scope');
	}
	if (err?.code === 'DEFAULT_ACTIVITY_MISSING' || err?.code === 'ACTIVITY_LOOKUP_FAILED') {
		return sendForbidden(res, 'Unable to resolve activity scope');
	}
	return null;
}
