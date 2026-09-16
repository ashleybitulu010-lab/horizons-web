export const RESPONSE_SOURCE = Object.freeze({
	TEMPLATE: 'TEMPLATE',
	LLM: 'LLM',
});

export const RESPONSE_STATUS = Object.freeze({
	COMPLETE: 'COMPLETE',
	PARTIAL: 'PARTIAL',
	FALLBACK: 'FALLBACK',
	ERROR: 'ERROR',
});

export const RESPONSE_STRATEGY = Object.freeze({
	DETERMINISTIC: 'DETERMINISTIC',
	LLM: 'LLM',
});

export function createEmptyGeneratedResponse() {
	return {
		text: '',
		source: RESPONSE_SOURCE.TEMPLATE,
		status: RESPONSE_STATUS.ERROR,
		analysisType: null,
		factsUsed: [],
		metricsUsed: [],
		driverIds: [],
		warnings: [],
		diagnostics: {
			responseStrategy: null,
			responseDurationMs: 0,
			validationStatus: null,
			fallbackReason: null,
		},
	};
}

export function validateGeneratedResponse(raw) {
	if (!raw || typeof raw !== 'object') {
		return { valid: false, error: 'RESPONSE_INVALID' };
	}

	const text = String(raw.text || '').trim();
	if (!text) {
		return { valid: false, error: 'RESPONSE_TEXT_REQUIRED' };
	}

	const source = raw.source || RESPONSE_SOURCE.TEMPLATE;
	if (!Object.values(RESPONSE_SOURCE).includes(source)) {
		return { valid: false, error: 'RESPONSE_SOURCE_INVALID' };
	}

	const status = raw.status || RESPONSE_STATUS.COMPLETE;
	if (!Object.values(RESPONSE_STATUS).includes(status)) {
		return { valid: false, error: 'RESPONSE_STATUS_INVALID' };
	}

	return {
		valid: true,
		value: {
			text,
			source,
			status,
			analysisType: raw.analysisType ?? null,
			factsUsed: Array.isArray(raw.factsUsed) ? raw.factsUsed.map(String) : [],
			metricsUsed: Array.isArray(raw.metricsUsed) ? raw.metricsUsed.map(String) : [],
			driverIds: Array.isArray(raw.driverIds) ? raw.driverIds.map(String) : [],
			warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
			diagnostics: raw.diagnostics || {},
		},
	};
}
