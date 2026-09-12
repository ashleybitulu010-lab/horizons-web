import { validateActivityForClient } from './activity-scope.js';
import { getSupabaseAdmin } from '../supabase/client.js';
import { isSupabaseConfigured } from '../config/env.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let listActivitiesForClientImpl = null;

export function setListActivitiesForClientImplForTests(impl) {
	listActivitiesForClientImpl = impl;
}

export function resetActivityReferenceResolverForTests() {
	listActivitiesForClientImpl = null;
}

function normalizeReference(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/\s+/g, ' ');
}

function normalizeName(value) {
	return normalizeReference(value);
}

async function defaultListActivitiesForClient(clientId) {
	if (!isSupabaseConfigured()) {
		throw new Error('SUPABASE_NOT_CONFIGURED');
	}
	const admin = getSupabaseAdmin();
	if (!admin) {
		throw new Error('SUPABASE_NOT_CONFIGURED');
	}

	const { data, error } = await admin
		.from('activities')
		.select('id, client_id, name, type, is_default')
		.eq('client_id', clientId)
		.order('name', { ascending: true });

	if (error) {
		throw new Error('ACTIVITY_LOOKUP_FAILED');
	}

	return (data || []).map((row) => ({
		id: row.id,
		clientId: row.client_id,
		name: row.name,
		type: row.type,
		isDefault: Boolean(row.is_default),
	}));
}

async function listActivitiesForClient(clientId) {
	if (listActivitiesForClientImpl) {
		return listActivitiesForClientImpl(clientId);
	}
	return defaultListActivitiesForClient(clientId);
}

function scoreNameMatch(referenceNorm, activityNameNorm) {
	if (!referenceNorm || !activityNameNorm) return 0;
	if (referenceNorm === activityNameNorm) return 100;
	if (activityNameNorm.includes(referenceNorm) || referenceNorm.includes(activityNameNorm)) {
		return 80;
	}
	return 0;
}

/**
 * Resolve a human activity reference among the authenticated client's activities only.
 * Never searches cross-tenant. LLM must not pass raw UUIDs — use validateActivityForClient for hints.
 */
export async function resolveActivityReference(clientId, reference) {
	const raw = String(reference || '').trim();
	if (!raw) {
		return { status: 'DEFAULT' };
	}

	if (UUID_PATTERN.test(raw)) {
		try {
			const activity = await validateActivityForClient(clientId, raw);
			return { status: 'RESOLVED', activity, matches: [activity] };
		} catch {
			return { status: 'NOT_FOUND', matches: [] };
		}
	}

	const referenceNorm = normalizeReference(raw);
	const activities = await listActivitiesForClient(clientId);
	const matches = activities.filter((activity) => {
		const score = scoreNameMatch(referenceNorm, normalizeName(activity.name));
		return score > 0;
	});

	if (matches.length === 0) {
		return { status: 'NOT_FOUND', matches: [] };
	}

	if (matches.length === 1) {
		return { status: 'RESOLVED', activity: matches[0], matches };
	}

	return {
		status: 'AMBIGUOUS',
		matches,
		clarificationQuestion: buildAmbiguousClarification(matches),
	};
}

export function buildAmbiguousClarification(matches) {
	const names = matches.map((m) => m.name).slice(0, 4);
	if (names.length === 2) {
		return `Tu parles de ${names[0]} ou de ${names[1]} ?`;
	}
	return `Tu parles de ${names.slice(0, -1).join(', ')} ou de ${names[names.length - 1]} ?`;
}
