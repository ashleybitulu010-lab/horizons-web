/**
 * Map backend conversation rows to the /history DTO expected by ChatContext.
 */

export function mapSupabaseMessageToHistoryDto(row) {
	if (!row) return null;

	return {
		id: row.id,
		role: row.role === 'user' ? 'user' : 'assistant',
		content: String(row.content || ''),
		timestamp: row.createdAt ?? null,
	};
}

export function mapSupabaseMessagesToHistoryDto(rows = []) {
	return rows
		.map(mapSupabaseMessageToHistoryDto)
		.filter((entry) => entry && entry.content.trim());
}
