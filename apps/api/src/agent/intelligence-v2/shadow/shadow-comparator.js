import {
	DIVERGENCE_CLASS,
	DIVERGENCE_SEVERITY,
	FINANCIAL_TOLERANCE,
} from './shadow-contract.js';
import { extractFinancialMetrics } from './shadow-normalizer.js';

const EXPLAIN_OBJECTIVES = new Set(['EXPLAIN', 'COMPARE']);

function metricsClose(a, b, tolerance = FINANCIAL_TOLERANCE) {
	if (a == null && b == null) return true;
	if (a == null || b == null) return false;
	return Math.abs(Number(a) - Number(b)) <= tolerance;
}

function compareFinancialMetrics(legacyMetrics, v2Metrics) {
	if (!legacyMetrics && !v2Metrics) {
		return { match: true, classification: DIVERGENCE_CLASS.MATCH };
	}
	if (!legacyMetrics || !v2Metrics) {
		return {
			match: false,
			classification: DIVERGENCE_CLASS.NO_DATA_DIFFERENCE,
			severity: DIVERGENCE_SEVERITY.MEDIUM,
		};
	}

	const keys = ['revenue', 'collected', 'expenses', 'profit', 'margin', 'expenseRatio'];
	const divergent = keys.filter((key) => !metricsClose(legacyMetrics[key], v2Metrics[key]));

	if (divergent.length === 0) {
		return { match: true, classification: DIVERGENCE_CLASS.MATCH };
	}

	return {
		match: false,
		classification: DIVERGENCE_CLASS.FINANCIAL_DIVERGENCE,
		severity: divergent.includes('profit') || divergent.includes('collected')
			? DIVERGENCE_SEVERITY.CRITICAL
			: DIVERGENCE_SEVERITY.HIGH,
		divergentKeys: divergent,
	};
}

function classifyIntentAlignment(legacy, v2) {
	const domainMatch = legacy.domain === v2.domain;
	const objectiveMatch = legacy.objective === v2.objective;
	const intentMatch = domainMatch && objectiveMatch
		&& (legacy.goalType === v2.goalType || (legacy.goalType && v2.goalType));

	if (intentMatch) {
		return {
			classification: DIVERGENCE_CLASS.MATCH,
			severity: DIVERGENCE_SEVERITY.LOW,
			intentMatch: true,
			domainMatch: true,
			objectiveMatch: true,
		};
	}

	if (EXPLAIN_OBJECTIVES.has(v2.objective) && legacy.domain !== v2.domain) {
		return {
			classification: DIVERGENCE_CLASS.EXPECTED_DIFFERENCE,
			severity: DIVERGENCE_SEVERITY.LOW,
			intentMatch: false,
			domainMatch,
			objectiveMatch,
		};
	}

	if (EXPLAIN_OBJECTIVES.has(v2.objective) && v2.tools.length > legacy.tools.length) {
		return {
			classification: DIVERGENCE_CLASS.V2_IMPROVEMENT,
			severity: DIVERGENCE_SEVERITY.LOW,
			intentMatch: false,
			domainMatch,
			objectiveMatch,
		};
	}

	return {
		classification: DIVERGENCE_CLASS.V2_REGRESSION,
		severity: DIVERGENCE_SEVERITY.HIGH,
		intentMatch: false,
		domainMatch,
		objectiveMatch,
	};
}

function compareTools(legacyTools = [], v2Tools = []) {
	const legacySet = new Set(legacyTools);
	const v2Set = new Set(v2Tools);
	const toolMatch = legacyTools.length === v2Tools.length
		&& legacyTools.every((tool) => v2Set.has(tool));
	const v2Extra = v2Tools.filter((tool) => !legacySet.has(tool));
	const legacyExtra = legacyTools.filter((tool) => !v2Set.has(tool));
	return { toolMatch, v2Extra, legacyExtra, legacyCount: legacyTools.length, v2Count: v2Tools.length };
}

function comparePeriods(legacy, v2) {
	if (!legacy.period && !v2.period) return { periodMatch: true };
	if (legacy.period === v2.period) return { periodMatch: true };
	return { periodMatch: false, classification: DIVERGENCE_CLASS.PERIOD_MISMATCH };
}

/**
 * Build structured Legacy vs V2 comparison.
 */
export function compareShadowSides({
	legacySide,
	v2Side,
	legacyFinancialAnalysis = null,
	v2FinancialAnalysis = null,
	v2Execution = null,
	shadowStatus = 'SUCCESS',
}) {
	if (shadowStatus === 'SHADOW_TIMEOUT') {
		return {
			classification: DIVERGENCE_CLASS.SHADOW_TIMEOUT,
			severity: DIVERGENCE_SEVERITY.LOW,
			intentMatch: false,
			domainMatch: false,
			objectiveMatch: false,
			periodMatch: false,
			toolMatch: false,
			financialMatch: false,
		};
	}

	if (shadowStatus === 'SHADOW_ERROR' || shadowStatus === 'SHADOW_WRITE_BLOCKED') {
		return {
			classification: shadowStatus === 'SHADOW_WRITE_BLOCKED'
				? DIVERGENCE_CLASS.SECURITY_DIVERGENCE
				: DIVERGENCE_CLASS.SHADOW_ERROR,
			severity: shadowStatus === 'SHADOW_WRITE_BLOCKED'
				? DIVERGENCE_SEVERITY.CRITICAL
				: DIVERGENCE_SEVERITY.MEDIUM,
			intentMatch: false,
			domainMatch: false,
			objectiveMatch: false,
			periodMatch: false,
			toolMatch: false,
			financialMatch: false,
		};
	}

	const intent = classifyIntentAlignment(legacySide, v2Side);
	const tools = compareTools(legacySide.tools, v2Side.tools);
	const period = comparePeriods(legacySide, v2Side);
	const financial = compareFinancialMetrics(
		extractFinancialMetrics(legacyFinancialAnalysis),
		extractFinancialMetrics(v2FinancialAnalysis),
	);

	let classification = intent.classification;
	let severity = intent.severity;

	if (!period.periodMatch && classification === DIVERGENCE_CLASS.MATCH) {
		classification = DIVERGENCE_CLASS.PERIOD_MISMATCH;
		severity = DIVERGENCE_SEVERITY.MEDIUM;
	}

	if (v2Execution?.partial && classification === DIVERGENCE_CLASS.MATCH) {
		classification = DIVERGENCE_CLASS.PARTIAL_DIFFERENCE;
		severity = DIVERGENCE_SEVERITY.MEDIUM;
	}

	if (!financial.match && financial.classification === DIVERGENCE_CLASS.FINANCIAL_DIVERGENCE) {
		classification = DIVERGENCE_CLASS.FINANCIAL_DIVERGENCE;
		severity = financial.severity;
	}

	if (!financial.match && financial.classification === DIVERGENCE_CLASS.NO_DATA_DIFFERENCE) {
		classification = DIVERGENCE_CLASS.NO_DATA_DIFFERENCE;
		severity = financial.severity || DIVERGENCE_SEVERITY.MEDIUM;
	}

	if (!tools.toolMatch && classification === DIVERGENCE_CLASS.MATCH && v2Side.tools.length > legacySide.tools.length) {
		classification = DIVERGENCE_CLASS.V2_IMPROVEMENT;
		severity = DIVERGENCE_SEVERITY.LOW;
	}

	return {
		classification,
		severity,
		intentMatch: intent.intentMatch,
		domainMatch: intent.domainMatch,
		objectiveMatch: intent.objectiveMatch,
		periodMatch: period.periodMatch,
		toolMatch: tools.toolMatch,
		financialMatch: financial.match,
		tools,
		financial,
	};
}

export function buildShadowComparisonResult({ legacy, v2, comparison }) {
	return {
		legacy,
		v2,
		comparison,
	};
}
