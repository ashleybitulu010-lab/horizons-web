export const FINANCIAL_ANALYSIS_TYPES = Object.freeze({
	EXPLANATION: 'EXPLANATION',
	COMPARISON: 'COMPARISON',
	RETRIEVE: 'RETRIEVE',
	SUMMARY: 'SUMMARY',
});

export const FINANCIAL_ANALYSIS_STATUS = Object.freeze({
	COMPLETE: 'COMPLETE',
	PARTIAL: 'PARTIAL',
	NO_DATA: 'NO_DATA',
	UNAVAILABLE: 'UNAVAILABLE',
	INVALID_INPUT: 'INVALID_INPUT',
});

export const MISSING_DATA_STATE = Object.freeze({
	NO_DATA: 'NO_DATA',
	NOT_AVAILABLE: 'NOT_AVAILABLE',
	INVALID_INPUT: 'INVALID_INPUT',
});

export function createEmptyFinancialAnalysis(domain) {
	return {
		domain: domain || 'GENERAL',
		analysisType: FINANCIAL_ANALYSIS_TYPES.SUMMARY,
		status: FINANCIAL_ANALYSIS_STATUS.UNAVAILABLE,
		periods: {
			current: null,
			previous: null,
		},
		metrics: {},
		comparisons: {},
		ratios: {},
		drivers: [],
		facts: [],
		interpretations: [],
		evidence: [],
		limitations: [],
		partial: false,
		sourceSteps: [],
		diagnostics: {
			analysisDurationMs: 0,
			metricCount: 0,
			driverCount: 0,
		},
	};
}
