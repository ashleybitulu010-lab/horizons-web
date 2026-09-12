import { createHash } from 'node:crypto';

/**
 * Temporary n8n message correlation helpers for Phase 5.7-B.
 *
 * LIMITATION (documented):
 * These keys are NOT permanent message identities. They do not guarantee
 * deduplication on frontend retries or legitimately repeated identical text.
 *
 * Future improvement: Idempotency-Key header or stable client message IDs
 * (frontend + backend phase — out of scope for 5.7-B).
 */

export function normalizeN8nMessageContent(content) {
	return String(content || '').trim().replace(/\s+/g, ' ');
}

/**
 * Build a soft correlation key stored in metadata for observability.
 * Does NOT block inserts — two identical messages may coexist by design.
 */
export function buildN8nExternalKey({ clientId, role, content, timestampMs = Date.now() }) {
	const normalized = normalizeN8nMessageContent(content);
	const bucket = Math.floor(Number(timestampMs) / 1000);
	const digest = createHash('sha256')
		.update(`${clientId}|${role}|${normalized}|${bucket}`)
		.digest('hex')
		.slice(0, 16);

	return `n8n:${role}:${digest}`;
}
