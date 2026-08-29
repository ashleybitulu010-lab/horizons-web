/**
 * Debt intent helpers for regex (and shared) resolver hardening.
 * Does not invent financial data — only parses explicit user wording.
 */

export const DEBT_STATUS = Object.freeze(['unpaid', 'settled', 'all']);

const SETTLED_DEBT_PATTERNS = [
	/dettes?\s+(r[eé]gl[eé]e?s?|pay[eé]e?s?|sold[eé]e?s?)/i,
	/(r[eé]gl[eé]e?s?|pay[eé]e?s?|sold[eé]e?s?)\s+(les\s+)?dettes?/i,
	/quelles?\s+dettes?\s+(sont\s+)?(r[eé]gl[eé]e?s?|pay[eé]e?s?|sold[eé]e?s?)/i,
	/montre.*dettes?\s+(r[eé]gl[eé]e?s?|pay[eé]e?s?)/i,
];

const ALL_DEBT_PATTERNS = [
	/toutes?\s+(les\s+)?dettes/i,
	/toutes?\s+mes\s+dettes/i,
	/montre.*toutes\s+(les\s+)?dettes/i,
	/liste\s+(de\s+)?toutes\s+(mes\s+)?dettes/i,
];

const UNPAID_DEBT_PATTERNS = [
	/impay/i,
	/encore\s+(due?s?|doiv)/i,
	/en cours/i,
	/celles?\s+(qui\s+sont\s+)?(encore\s+)?impay/i,
	/dettes?\s+impay/i,
	/impay.*dettes?/i,
	/encore\s+du(?:e?s?)?\s+(?:argent|monnaie)?/i,
	/dettes?\s+en cours/i,
];

const DEBTOR_PATTERNS = [
	/combien me doit\s+(.+?)\??$/i,
	/combien\s+(.+?)\s+me\s+doit/i,
	/^(?:et\s+)?celles?\s+(?:de|du|d['’])\s*(.+?)\??$/i,
	/dettes?\s+(?:de|du|d['’])\s*(.+?)\??$/i,
	/(?:client|d[eé]biteur)\s+(.+?)\??$/i,
];

const DEBT_PERIOD_PATTERNS = [
	{ pattern: /(ce|cette)\s+mois/i, period: 'current_month' },
	{ pattern: /mois\s+(dernier|pass[eé])/i, period: 'previous_month' },
];

export function extractDebtorFromText(text) {
	const normalized = String(text || '').trim();
	if (!normalized) return null;

	for (const pattern of DEBTOR_PATTERNS) {
		const match = normalized.match(pattern);
		const raw = match?.[1]?.trim();
		if (!raw) continue;

		const cleaned = raw
			.replace(/^(les|mes)\s+/i, '')
			.replace(/\?(.*)$/,'')
			.trim();

		if (!cleaned || /^(dettes?|impay|r[eé]gl)/i.test(cleaned)) continue;
		if (cleaned.length < 2) continue;
		return cleaned;
	}

	return null;
}

export function extractDebtPeriodFromText(text, conversationState = {}) {
	const normalized = String(text || '').trim();
	for (const entry of DEBT_PERIOD_PATTERNS) {
		if (entry.pattern.test(normalized)) {
			return entry.period;
		}
	}

	if (conversationState.topic === 'debts') {
		return conversationState.references?.lastPeriod
			|| conversationState.filters?.period
			|| null;
	}

	return null;
}

/**
 * Resolve debt status from explicit wording.
 * Generic debt questions default to unpaid (documented product choice).
 */
export function resolveDebtStatusFromText(text, conversationState = {}) {
	const normalized = String(text || '').trim();
	const hasSettled = SETTLED_DEBT_PATTERNS.some((pattern) => pattern.test(normalized))
		|| /\b(r[eé]gl[eé]e?s?|pay[eé]e?s?|sold[eé]e?s?)\b/i.test(normalized);
	const hasUnpaid = UNPAID_DEBT_PATTERNS.some((pattern) => pattern.test(normalized))
		|| /\bimpay/i.test(normalized);
	const hasAll = ALL_DEBT_PATTERNS.some((pattern) => pattern.test(normalized));

	if (hasSettled && hasUnpaid) {
		return { status: null, ambiguous: true };
	}

	if (/toutes?\s+(?:les\s+)?dettes?\s+impay/i.test(normalized)) {
		return { status: 'unpaid', explicit: true };
	}
	if (/toutes?\s+(?:les\s+)?dettes?\s+(?:r[eé]gl|pay)/i.test(normalized)) {
		return { status: 'settled', explicit: true };
	}

	if (hasAll && !hasSettled && !hasUnpaid) {
		return { status: 'all', explicit: true };
	}

	if (hasSettled) {
		return { status: 'settled', explicit: true };
	}

	if (hasUnpaid) {
		return { status: 'unpaid', explicit: true };
	}

	if (conversationState.topic === 'debts' && conversationState.filters?.status) {
		return {
			status: conversationState.filters.status,
			inherited: true,
		};
	}

	return { status: 'unpaid', defaultGeneric: true };
}

export function buildDebtQueryFilters(text, conversationState = {}) {
	const statusResult = resolveDebtStatusFromText(text, conversationState);

	if (statusResult.ambiguous) {
		return {
			filters: {},
			needsClarification: true,
			clarificationQuestion: 'Parles-tu de dettes impayées, de dettes réglées, ou de toutes tes dettes ?',
		};
	}

	const filters = {
		status: statusResult.status || 'unpaid',
	};

	const debtor = extractDebtorFromText(text);
	if (debtor) {
		filters.debtor = debtor;
	}

	const period = extractDebtPeriodFromText(text, conversationState);
	if (period) {
		filters.period = period;
	}

	return {
		filters,
		needsClarification: false,
		clarificationQuestion: null,
	};
}

export function isDebtRelatedText(text) {
	const normalized = String(text || '').trim().toLowerCase();
	if (!normalized) return false;

	return /dettes?|me doit|doivent|impay|d[eé]biteur|qui me doit|celles?\s+(?:de|du|d['’])/i.test(normalized);
}
