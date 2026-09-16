const SECRET_PATTERNS = [
	/\bsk-[A-Za-z0-9]{10,}\b/i,
	/\bBearer\s+[A-Za-z0-9._-]+\b/i,
	/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
];

const INTERNAL_PATTERNS = [
	/\bclientId\b/i,
	/\buserId\b/i,
	/\bactivityId\b/i,
	/\bstepId\b/i,
	/\boperationId\b/i,
	/\bget_sales\b/i,
	/\bget_expenses\b/i,
	/\bFinancialAnalysisResult\b/i,
	/\borchestrator\b/i,
	/\bplanner\b/i,
];

const SQL_PATTERNS = [
	/\bselect\b.+\bfrom\b/i,
	/\binsert\b.+\binto\b/i,
	/\bupdate\b.+\bset\b/i,
	/\bdelete\b.+\bfrom\b/i,
	/\bsupabase\b/i,
];

const STACK_PATTERNS = [
	/\bat\s+.+\(.+:\d+:\d+\)/,
	/\bError:\s+.+\n\s+at\s+/,
	/\bstack trace\b/i,
];

export function sanitizeResponseText(text) {
	let output = String(text || '').trim();
	if (!output) return output;

	for (const pattern of [...SECRET_PATTERNS, ...SQL_PATTERNS, ...STACK_PATTERNS]) {
		if (pattern.test(output)) {
			return null;
		}
	}

	for (const pattern of INTERNAL_PATTERNS) {
		output = output.replace(pattern, '');
	}

	output = output.replace(
		/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
		'',
	);

	return output.replace(/\s{2,}/g, ' ').trim();
}

export function detectUnsafeResponseContent(text) {
	const value = String(text || '');
	const checks = [
		{ name: 'SECRET', patterns: SECRET_PATTERNS },
		{ name: 'SQL', patterns: SQL_PATTERNS },
		{ name: 'STACK', patterns: STACK_PATTERNS },
		{ name: 'UUID', patterns: [/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i] },
		{ name: 'INTERNAL_ID', patterns: [/\b(clientId|userId|activityId|stepId)\b/i] },
	];

	for (const check of checks) {
		for (const pattern of check.patterns) {
			if (pattern.test(value)) {
				return { safe: false, reason: check.name };
			}
		}
	}

	return { safe: true };
}
