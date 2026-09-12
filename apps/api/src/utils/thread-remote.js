/**
 * Response builders that distinguish local (browser) vs remote (n8n) persistence.
 * The frontend ignores these fields today but they prevent false remote-save claims.
 */

export function buildSaveMessageResponse({ remoteSaved, reason = null }) {
	return {
		success: true,
		remote: remoteSaved
			? { saved: true }
			: { saved: false, reason: reason || 'remote_unavailable' },
		local: { managedByClient: true },
	};
}

export function buildHistoryResponse(messages, { source = 'n8n_history' } = {}) {
	return {
		success: true,
		messages,
		remote: {
			source,
			count: messages.length,
		},
		local: { managedByClient: true },
	};
}

export function buildGetThreadResponse(messages, { source = 'n8n_get_thread' } = {}) {
	return {
		success: true,
		messages,
		remote: {
			source,
			count: messages.length,
		},
		local: { managedByClient: true },
	};
}
