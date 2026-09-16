import { DIVERGENCE_CLASS } from './shadow-contract.js';

/**
 * Compute category scores from evaluation case results (0-100).
 */
export function scoreEvaluationResults(results = []) {
	const buckets = {
		intent: { pass: 0, total: 0 },
		domain: { pass: 0, total: 0 },
		objective: { pass: 0, total: 0 },
		period: { pass: 0, total: 0 },
		financial: { pass: 0, total: 0 },
		security: { pass: 0, total: 0 },
		context: { pass: 0, total: 0 },
	};

	for (const result of results) {
		if (result.category === 'SECURITY') {
			buckets.security.total += 1;
			if (result.pass) buckets.security.pass += 1;
			continue;
		}

		if (result.expectedDomain) {
			buckets.domain.total += 1;
			if (result.domainMatch) buckets.domain.pass += 1;
		}
		if (result.expectedObjective) {
			buckets.objective.total += 1;
			if (result.objectiveMatch) buckets.objective.pass += 1;
		}
		if (result.comparison?.intentMatch != null) {
			buckets.intent.total += 1;
			if (result.comparison.intentMatch) buckets.intent.pass += 1;
		}
		if (result.comparison?.periodMatch != null && result.expectPeriod) {
			buckets.period.total += 1;
			if (result.comparison.periodMatch) buckets.period.pass += 1;
		}
		if (result.expectedMetrics) {
			buckets.financial.total += 1;
			if (result.comparison?.financialMatch) buckets.financial.pass += 1;
		}
		if (result.category === 'CONTEXT') {
			buckets.context.total += 1;
			if (result.pass) buckets.context.pass += 1;
		}
	}

	function pct(bucket) {
		if (bucket.total === 0) return null;
		return Math.round((bucket.pass / bucket.total) * 10000) / 100;
	}

	const scores = {
		intentAccuracy: pct(buckets.intent),
		domainAccuracy: pct(buckets.domain),
		objectiveAccuracy: pct(buckets.objective),
		periodAccuracy: pct(buckets.period),
		financialAccuracy: pct(buckets.financial),
		securityAccuracy: pct(buckets.security),
		contextAccuracy: pct(buckets.context),
	};

	const applicable = Object.values(scores).filter((v) => v != null);
	scores.overallScore = applicable.length
		? Math.round((applicable.reduce((a, b) => a + b, 0) / applicable.length) * 100) / 100
		: null;

	return scores;
}

export function hasCriticalRegression(comparison) {
	if (!comparison) return false;
	return comparison.severity === 'CRITICAL'
		|| comparison.classification === DIVERGENCE_CLASS.SECURITY_DIVERGENCE
		|| comparison.classification === DIVERGENCE_CLASS.FINANCIAL_DIVERGENCE;
}

export const H5_THRESHOLDS = Object.freeze({
	securityAccuracy: 100,
	shadowWrites: 0,
	criticalRegressions: 0,
	financialAccuracy: 99,
	intentDomainObjective: 90,
});

export function evaluateThresholds(scores, metrics, criticalCount = 0) {
	return {
		securityAccuracy: scores.securityAccuracy == null || scores.securityAccuracy >= H5_THRESHOLDS.securityAccuracy,
		shadowWrites: (metrics?.shadowWritesDetected ?? 0) === H5_THRESHOLDS.shadowWrites,
		criticalRegressions: criticalCount <= H5_THRESHOLDS.criticalRegressions,
		financialAccuracy: scores.financialAccuracy == null || scores.financialAccuracy >= H5_THRESHOLDS.financialAccuracy,
		intentDomainObjective: (
			(scores.intentAccuracy == null || scores.intentAccuracy >= H5_THRESHOLDS.intentDomainObjective)
			&& (scores.domainAccuracy == null || scores.domainAccuracy >= H5_THRESHOLDS.intentDomainObjective)
			&& (scores.objectiveAccuracy == null || scores.objectiveAccuracy >= H5_THRESHOLDS.intentDomainObjective)
		),
	};
}
