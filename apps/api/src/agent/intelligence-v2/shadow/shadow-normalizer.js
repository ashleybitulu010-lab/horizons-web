import { specTypeToLegacyPeriodId } from '../period-contract.js';

function normalizePeriodFromGoal(goal, context = {}) {
	if (!goal) {
		return context.filters?.period || context.references?.lastPeriod || null;
	}
	if (goal.period?.legacyPeriodId) return goal.period.legacyPeriodId;
	if (goal.period?.type) return specTypeToLegacyPeriodId(goal.period.type);
	if (goal.comparison?.leftPeriod?.legacyPeriodId) {
		return goal.comparison.leftPeriod.legacyPeriodId;
	}
	return context.filters?.period || context.references?.lastPeriod || null;
}

function normalizeComparisonFromGoal(goal) {
	if (!goal?.comparison?.enabled) return null;
	return {
		enabled: true,
		metric: goal.comparison.metric || null,
		left: goal.comparison.leftPeriod?.legacyPeriodId
			|| specTypeToLegacyPeriodId(goal.comparison.leftPeriod?.type)
			|| null,
		right: goal.comparison.rightPeriod?.legacyPeriodId
			|| specTypeToLegacyPeriodId(goal.comparison.rightPeriod?.type)
			|| null,
	};
}

export function normalizeLegacySide({ legacyResolved, legacyGoal, legacyPlan }) {
	const mapped = legacyGoal?.valid ? legacyGoal.value : null;
	return {
		intent: legacyResolved?.intent || null,
		domain: mapped?.domain || null,
		objective: mapped?.objective || null,
		goalType: mapped?.type || null,
		period: legacyResolved?.filters?.period || normalizePeriodFromGoal(mapped),
		comparison: mapped?.comparison ? normalizeComparisonFromGoal(mapped) : null,
		tools: (legacyPlan?.steps || []).map((step) => step.tool),
		status: legacyPlan?.responseKind || null,
	};
}

export function normalizeV2Side({
	classifierGoal,
	v2Plan,
	v2Execution,
	v2ActionProposal,
}) {
	return {
		intent: null,
		domain: classifierGoal?.domain || null,
		objective: classifierGoal?.objective || null,
		goalType: classifierGoal?.type || null,
		period: normalizePeriodFromGoal(classifierGoal),
		comparison: normalizeComparisonFromGoal(classifierGoal),
		tools: v2Plan?.success && v2Plan.plan
			? v2Plan.plan.steps.map((step) => step.tool)
			: [],
		status: v2Execution?.code || (v2ActionProposal ? 'ACTION_PROPOSAL' : null),
		actionTool: v2ActionProposal?.tool || null,
	};
}

export function extractFinancialMetrics(financialAnalysis) {
	if (!financialAnalysis?.metrics) return null;
	const m = financialAnalysis.metrics;
	return {
		revenue: m.revenue ?? m.currentRevenue ?? null,
		collected: m.totalCollected ?? m.collected ?? null,
		expenses: m.expenses ?? m.currentExpenses ?? null,
		profit: m.profit ?? m.currentProfit ?? null,
		margin: m.profitMargin ?? m.margin ?? null,
		expenseRatio: m.expenseToRevenueRatio ?? m.expenseRatio ?? null,
	};
}
