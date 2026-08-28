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
