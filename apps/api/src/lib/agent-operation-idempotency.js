import { createHash, randomUUID } from 'node:crypto';

/**
 * Canonical fields hashed for durable idempotency (F4-B2-C).
 * Excludes volatile metadata (tokens, timestamps, confirmation flags).
 */
const CANONICAL_FIELDS = Object.freeze({
	create_expense: ['label', 'amount'],
	create_sale: ['product', 'quantity', 'unitPrice', 'amountPaid'],
});

function normalizeNumber(value) {
	if (value == null) return null;
	const num = Number(value);
	if (!Number.isFinite(num)) return null;
	return num;
}

function normalizeString(value) {
	if (value == null) return '';
	return String(value).trim();
}

/**
 * Build stable business payload for request_hash (scoped by authenticated client_id).
 * @param {string} clientId
 * @param {{ tool: string, [key: string]: unknown }} pendingWrite
 */
export function buildCanonicalOperationPayload(clientId, pendingWrite) {
	if (!pendingWrite?.tool) {
		throw new Error('pendingWrite.tool is required for request_hash');
	}

	const fields = CANONICAL_FIELDS[pendingWrite.tool];
	if (!fields) {
		throw new Error(`Unsupported pendingWrite tool for request_hash: ${pendingWrite.tool}`);
	}

	/** @type {Record<string, unknown>} */
	const payload = {
		clientId,
		tool: pendingWrite.tool,
	};

	for (const key of fields) {
		const raw = pendingWrite[key];
		if (key === 'label' || key === 'product') {
			payload[key] = normalizeString(raw);
		} else {
			payload[key] = normalizeNumber(raw);
		}
	}

	return payload;
}

/**
 * Stable JSON: sorted keys, no whitespace variance.
 * @param {Record<string, unknown>} payload
 */
export function canonicalJsonStringify(payload) {
	const sorted = Object.keys(payload).sort();
	/** @type {Record<string, unknown>} */
	const ordered = {};
	for (const key of sorted) {
		ordered[key] = payload[key];
	}
	return JSON.stringify(ordered);
}

/**
 * SHA-256 hex hash of canonical business payload.
 * @param {string} clientId — authenticated tenant scope (server-side)
 * @param {{ tool: string, [key: string]: unknown }} pendingWrite
 */
export function computeRequestHash(clientId, pendingWrite) {
	const payload = buildCanonicalOperationPayload(clientId, pendingWrite);
	return createHash('sha256').update(canonicalJsonStringify(payload)).digest('hex');
}

/** Backend-generated operation identity — never accept from model/client input. */
export function generateOperationId() {
	return randomUUID();
}
