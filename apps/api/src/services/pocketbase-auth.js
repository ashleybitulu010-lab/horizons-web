import { getEnv } from '../config/env.js';

let verifyTokenImpl = null;

function getDefaultPocketBaseUrl() {
	const env = getEnv();
	return env.pocketbaseUrl.replace(/\/$/, '');
}

export function setTokenVerifierForTests(verifier) {
	verifyTokenImpl = verifier;
}

export function resetTokenVerifierForTests() {
	verifyTokenImpl = null;
}

export function extractBearerToken(headerValue) {
	if (!headerValue || typeof headerValue !== 'string') return null;
	const trimmed = headerValue.trim();
	if (!trimmed) return null;
	if (trimmed.toLowerCase().startsWith('bearer ')) {
		return trimmed.slice(7).trim() || null;
	}
	return trimmed;
}

async function defaultVerifyPocketBaseToken(token) {
	if (!token) return null;

	const pocketbaseUrl = getDefaultPocketBaseUrl();
	const response = await fetch(`${pocketbaseUrl}/api/collections/users/auth-refresh`, {
		method: 'POST',
		headers: {
			Authorization: token,
			Accept: 'application/json; charset=UTF-8',
		},
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) return null;

	const payload = await response.json();
	const record = payload?.record || payload;
	if (!record?.id) return null;

	return {
		id: record.id,
		email: record.email || null,
		firstName: record.firstName || null,
		lastName: record.lastName || null,
		name: record.name || null,
		airtableId: record.airtableId || record.airtable_id || null,
	};
}

export async function verifyPocketBaseToken(token) {
	const verifier = verifyTokenImpl || defaultVerifyPocketBaseToken;
	return verifier(token);
}
