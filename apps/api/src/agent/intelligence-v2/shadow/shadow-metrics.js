import { DIVERGENCE_CLASS } from './shadow-contract.js';

const globalMetrics = {
	totalRuns: 0,
	successfulRuns: 0,
	timeoutRuns: 0,
	errorRuns: 0,
	intentMatches: 0,
	intentDivergences: 0,
	financialMatches: 0,
	financialDivergences: 0,
	v2Improvements: 0,
	v2Regressions: 0,
	expectedDifferences: 0,
	actionProposals: 0,
	shadowWritesDetected: 0,
};

export function createEmptyShadowMetrics() {
	return {
		totalRuns: 0,
		successfulRuns: 0,
		timeoutRuns: 0,
		errorRuns: 0,
		intentMatches: 0,
		intentDivergences: 0,
		financialMatches: 0,
		financialDivergences: 0,
		v2Improvements: 0,
		v2Regressions: 0,
		expectedDifferences: 0,
		actionProposals: 0,
		shadowWritesDetected: 0,
	};
}

export function recordShadowRunMetrics(metrics, diagnostic) {
	const next = { ...metrics };
	next.totalRuns += 1;

	if (diagnostic?.status === 'SHADOW_TIMEOUT') {
		next.timeoutRuns += 1;
	} else if (diagnostic?.status === 'SHADOW_ERROR' || diagnostic?.status === 'SHADOW_WRITE_BLOCKED') {
		next.errorRuns += 1;
	} else {
		next.successfulRuns += 1;
	}

	const cmp = diagnostic?.comparison;
	if (cmp?.intentMatch) next.intentMatches += 1;
	else next.intentDivergences += 1;

	if (cmp?.financialMatch) next.financialMatches += 1;
	else if (cmp?.classification === DIVERGENCE_CLASS.FINANCIAL_DIVERGENCE) {
		next.financialDivergences += 1;
	}

	if (cmp?.classification === DIVERGENCE_CLASS.V2_IMPROVEMENT) next.v2Improvements += 1;
	if (cmp?.classification === DIVERGENCE_CLASS.V2_REGRESSION) next.v2Regressions += 1;
	if (cmp?.classification === DIVERGENCE_CLASS.EXPECTED_DIFFERENCE) next.expectedDifferences += 1;

	if (diagnostic?.v2ActionProposal) next.actionProposals += 1;
	if (diagnostic?.shadowWritesDetected > 0) {
		next.shadowWritesDetected += diagnostic.shadowWritesDetected;
	}

	return next;
}

let testMetricsStore = null;

export function getShadowMetricsForTests() {
	return testMetricsStore || globalMetrics;
}

export function resetShadowMetricsForTests() {
	testMetricsStore = createEmptyShadowMetrics();
	return testMetricsStore;
}

export function mergeIntoGlobalShadowMetrics(diagnostic) {
	Object.assign(globalMetrics, recordShadowRunMetrics(globalMetrics, diagnostic));
	if (testMetricsStore) {
		Object.assign(testMetricsStore, recordShadowRunMetrics(testMetricsStore, diagnostic));
	}
}
