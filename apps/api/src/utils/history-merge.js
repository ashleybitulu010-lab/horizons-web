/**
 * Cross-source history merge for Phase 5.6 coexistence (Supabase + n8n).
 *
 * LIMITATION (documented):
 * Cross-source deduplication uses role + normalized content + nearby timestamps only.
 * It is a temporary heuristic — NOT a stable message identity.
 * Repeated identical text on different days must remain distinct.
 * When timestamps are missing or ambiguous, both messages are kept.
 */

/** Max age delta to treat cross-source entries as the same saved turn. */
export const CROSS_SOURCE_DEDUP_WINDOW_MS = 120_000;

export function normalizeHistoryContent(content) {
	return String(content || '').trim().replace(/\s+/g, ' ');
}

function timestampMs(value) {
	if (!value) return null;
	const ms = new Date(value).getTime();
	return Number.isFinite(ms) ? ms : null;
}

/**
 * Conservative duplicate detection across Supabase and n8n only.
 * Returns true only when role, content, and timestamps are all present and close.
 */
export function isLikelyCrossSourceDuplicate(supabaseMessage, n8nMessage) {
	if (!supabaseMessage || !n8nMessage) return false;
	if (supabaseMessage.role !== n8nMessage.role) return false;
	if (normalizeHistoryContent(supabaseMessage.content) !== normalizeHistoryContent(n8nMessage.content)) {
		return false;
	}

	const supabaseTs = timestampMs(supabaseMessage.timestamp);
	const n8nTs = timestampMs(n8nMessage.timestamp);

	if (supabaseTs == null || n8nTs == null) {
		return false;
	}

	return Math.abs(supabaseTs - n8nTs) <= CROSS_SOURCE_DEDUP_WINDOW_MS;
}

export function compareHistoryMessages(a, b) {
	const tsA = timestampMs(a?.timestamp);
	const tsB = timestampMs(b?.timestamp);

	if (tsA != null && tsB != null) {
		if (tsA !== tsB) return tsA - tsB;
		return String(a.id).localeCompare(String(b.id));
	}
	if (tsA != null) return -1;
	if (tsB != null) return 1;
	return String(a.id).localeCompare(String(b.id));
}

export function sortHistoryMessages(messages) {
	return [...messages].sort(compareHistoryMessages);
}

/**
 * Merge Supabase (authoritative for Ashy v2) with legacy n8n history.
 * Supabase messages are always kept. n8n messages are appended unless
 * confidently duplicated against a Supabase row.
 */
export function mergeHistorySources(supabaseMessages = [], n8nMessages = []) {
	const merged = [...supabaseMessages];

	for (const n8nMessage of n8nMessages) {
		const isDuplicate = supabaseMessages.some(
			(supabaseMessage) => isLikelyCrossSourceDuplicate(supabaseMessage, n8nMessage),
		);
		if (!isDuplicate) {
			merged.push(n8nMessage);
		}
	}

	return sortHistoryMessages(merged);
}
