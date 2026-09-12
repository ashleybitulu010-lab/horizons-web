import {
	attachActivityScopeToUser,
	extractExplicitActivityId,
} from '../services/activity-scope.js';
import { handleScopeError } from '../services/supabase-scoped.js';

/**
 * Resolve active activity after authentication.
 * Uses X-Activity-Id header or body/query hint; falls back to default activity.
 */
export async function resolveActivityScope(req, res, next) {
	if (!req.user?.clientId) {
		return next();
	}

	try {
		const explicitActivityId = extractExplicitActivityId(req);
		req.activityScope = await attachActivityScopeToUser(req.user, explicitActivityId);
		return next();
	} catch (err) {
		const handled = handleScopeError(res, err);
		if (handled) return handled;
		return next(err);
	}
}
