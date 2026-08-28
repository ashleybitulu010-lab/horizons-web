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

export function assertClientOwnership(user, clientId) {
	if (!user?.clientId || !clientId || user.clientId !== clientId) {
		const error = new Error('CLIENT_OWNERSHIP_VIOLATION');
		error.code = 'CLIENT_OWNERSHIP_VIOLATION';
		throw error;
	}
}

export function applyClientFilter(query, user) {
	const clientId = requireClientScope(user);
	return query.eq('client_id', clientId);
}

export function handleScopeError(res, err) {
	if (err?.code === 'CLIENT_OWNERSHIP_VIOLATION' || err?.code === 'SUPABASE_CLIENT_SCOPE_MISSING') {
		return sendForbidden(res, 'Access denied for this client scope');
	}
	return null;
}
