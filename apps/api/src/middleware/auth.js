import { verifyPocketBaseToken, extractBearerToken } from '../services/pocketbase-auth.js';
import { buildRequestUser, userIdentityKeys } from '../services/user-context.js';
import { sendForbidden, sendUnauthenticated } from '../utils/auth-errors.js';
import { logAuthEvent } from './auth-log.js';

function collectClientIdentityHints(req) {
	return [
		req.params?.userId,
		req.body?.userId,
		req.body?.user_id,
		req.body?.pbUserId,
	].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
}

function collectClientScopeHints(req) {
	return [
		req.body?.clientId,
		req.body?.client_id,
		req.query?.clientId,
		req.query?.client_id,
		req.params?.clientId,
		req.params?.client_id,
	].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
}

function collectActivityScopeHints(req) {
	return [
		req.body?.activityId,
		req.body?.activity_id,
		req.query?.activityId,
		req.query?.activity_id,
		req.params?.activityId,
		req.params?.activity_id,
	].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
}

export function rejectForeignIdentity(req, res, next) {
	if (!req.user) return next();

	const allowed = userIdentityKeys(req.user);
	for (const candidate of collectClientIdentityHints(req)) {
		if (!allowed.has(candidate)) {
			logAuthEvent('identity_mismatch', {
				route: req.path,
				userId: req.user.id,
				result: 'forbidden',
			});
			return sendForbidden(res, 'Cannot act on behalf of another user');
		}
	}

	return next();
}

export function rejectForeignScope(req, res, next) {
	if (!req.user) return next();

	if (req.user.clientId) {
		for (const candidate of collectClientScopeHints(req)) {
			if (candidate !== req.user.clientId) {
				logAuthEvent('client_scope_mismatch', {
					route: req.path,
					userId: req.user.id,
					result: 'forbidden',
				});
				return sendForbidden(res, 'Access denied for this client scope');
			}
		}
	}

	if (req.user.activeActivityId) {
		for (const candidate of collectActivityScopeHints(req)) {
			if (candidate !== req.user.activeActivityId) {
				logAuthEvent('activity_scope_mismatch', {
					route: req.path,
					userId: req.user.id,
					result: 'forbidden',
				});
				return sendForbidden(res, 'Access denied for this activity scope');
			}
		}
	}

	return next();
}

export async function requireAuth(req, res, next) {
	const token = extractBearerToken(req.get('authorization') || req.get('Authorization'));

	if (!token) {
		logAuthEvent('missing_token', { route: req.path, result: 'unauthenticated' });
		return sendUnauthenticated(res);
	}

	try {
		const record = await verifyPocketBaseToken(token);
		if (!record) {
			logAuthEvent('invalid_token', { route: req.path, result: 'unauthenticated' });
			return sendUnauthenticated(res, 'Invalid or expired session');
		}

		req.user = await buildRequestUser(record);
		req.auth = { provider: 'pocketbase', tokenPresent: true };

		logAuthEvent('authenticated', {
			route: req.path,
			userId: req.user.id,
			result: 'ok',
		});

		return next();
	} catch (err) {
		logAuthEvent('auth_error', {
			route: req.path,
			result: 'unauthenticated',
			message: err instanceof Error ? err.message : 'unknown',
		});
		return sendUnauthenticated(res, 'Authentication failed');
	}
}

export function assertParamUserIsSelf(paramName = 'userId') {
	return (req, res, next) => {
		if (!req.user) {
			return sendUnauthenticated(res);
		}

		const paramValue = req.params?.[paramName];
		if (!paramValue) {
			return next();
		}

		const allowed = userIdentityKeys(req.user);
		if (!allowed.has(paramValue)) {
			logAuthEvent('param_identity_mismatch', {
				route: req.path,
				userId: req.user.id,
				result: 'forbidden',
			});
			return sendForbidden(res, 'Cannot access another user\'s thread');
		}

		return next();
	};
}
