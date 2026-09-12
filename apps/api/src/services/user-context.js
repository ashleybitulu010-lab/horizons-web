import { getSupabaseAdmin } from '../supabase/client.js';
import { isSupabaseConfigured } from '../config/env.js';

function identityCandidates(record) {
	return Array.from(new Set([
		record.airtableId,
		record.id,
		record.email,
	].filter(Boolean)));
}

/**
 * n8n / chat session id — mirrors frontend resolveStorageId().
 */
export function resolveBusinessUserId(record) {
	return record.airtableId || record.id || record.email || null;
}

export async function resolveSupabaseClientRow(record) {
	if (!isSupabaseConfigured()) return null;

	const admin = getSupabaseAdmin();
	if (!admin) return null;

	const candidates = identityCandidates(record);
	if (!candidates.length) return null;

	const { data, error } = await admin
		.from('clients')
		.select('id, user_id, auth_user_id')
		.in('user_id', candidates)
		.limit(1)
		.maybeSingle();

	if (error || !data) return null;
	return data;
}

let buildRequestUserImpl = null;

export function setBuildRequestUserImplForTests(impl) {
	buildRequestUserImpl = impl;
}

export function resetBuildRequestUserImplForTests() {
	buildRequestUserImpl = null;
}

export async function buildRequestUser(record) {
	if (buildRequestUserImpl) {
		return buildRequestUserImpl(record);
	}

	const businessUserId = resolveBusinessUserId(record);
	const clientRow = await resolveSupabaseClientRow(record);

	return {
		id: record.id,
		email: record.email || null,
		firstName: record.firstName || null,
		lastName: record.lastName || null,
		airtableId: record.airtableId || null,
		businessUserId,
		clientId: clientRow?.id || null,
		supabaseAuthUserId: clientRow?.auth_user_id || null,
		clientUserId: clientRow?.user_id || null,
	};
}

export function userIdentityKeys(user) {
	return new Set([
		user?.id,
		user?.airtableId,
		user?.businessUserId,
		user?.clientUserId,
		user?.email,
	].filter(Boolean));
}
