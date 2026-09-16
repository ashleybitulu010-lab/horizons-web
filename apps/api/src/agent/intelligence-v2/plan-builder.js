import { getToolDefinition } from '../../tools/registry.js';
import { validateAnalysisPlan } from './analysis-plan-contract.js';
import { validateGoal } from './goal-contract.js';
import { specTypeToLegacyPeriodId } from './period-contract.js';
import {
	inferPreviousLegacyPeriod,
	requiredEvidenceForGoal,
} from './plan-evidence.js';
import { validateAnalysisPlanExtended } from './plan-validator-extended.js';

function legacyPeriodFromGoalPeriod(periodSpec, fallback = 'current_month') {
	if (!periodSpec) return fallback;
	if (periodSpec.legacyPeriodId) return periodSpec.legacyPeriodId;
	return specTypeToLegacyPeriodId(periodSpec.type) || fallback;
}

function resolvePeriodPair(goal, context = {}) {
	const inherited = context.references?.lastPeriod
		|| context.filters?.period
		|| 'current_month';

	if (goal.comparison?.enabled && goal.comparison.leftPeriod && goal.comparison.rightPeriod) {
		return {
			current: legacyPeriodFromGoalPeriod(goal.comparison.leftPeriod, inherited),
			previous: legacyPeriodFromGoalPeriod(goal.comparison.rightPeriod, 'previous_month'),
		};
	}

	const current = legacyPeriodFromGoalPeriod(goal.period, inherited);
	return {
		current,
		previous: inferPreviousLegacyPeriod(current),
	};
}

function createReadStep(id, tool, argumentsObj, purpose) {
	if (!getToolDefinition(tool)?.implemented) {
		return null;
	}

	return {
		id,
		tool,
		arguments: argumentsObj,
		dependsOn: [],
		purpose,
		readOnly: true,
	};
}

function buildStepsFromEvidence(evidenceList, goal, context = {}) {
	const steps = [];
	const periods = resolvePeriodPair(goal, context);
	const params = goal.parameters || {};

	for (const evidence of evidenceList) {
		switch (evidence) {
		case 'sales_period': {
			const args = { period: periods.current };
			if (params.product) args.product = params.product;
			const step = createReadStep(
				'sales_current',
				'get_sales',
				args,
				'retrieve_current_period_sales',
			);
			if (!step) return null;
			steps.push(step);
			break;
		}
		case 'sales_comparison': {
			const args = { period: periods.previous };
			if (params.product) args.product = params.product;
			const step = createReadStep(
				'sales_previous',
				'get_sales',
				args,
				'retrieve_previous_period_sales',
			);
			if (!step) return null;
			steps.push(step);
			break;
		}
		case 'expenses_period': {
			const args = { period: periods.current };
			if (params.category) args.category = params.category;
			const step = createReadStep(
				'expenses_current',
				'get_expenses',
				args,
				'retrieve_current_period_expenses',
			);
			if (!step) return null;
			steps.push(step);
			break;
		}
		case 'expenses_comparison': {
			const args = { period: periods.previous };
			if (params.category) args.category = params.category;
			const step = createReadStep(
				'expenses_previous',
				'get_expenses',
				args,
				'retrieve_previous_period_expenses',
			);
			if (!step) return null;
			steps.push(step);
			break;
		}
		case 'stock_snapshot': {
			const args = {};
			if (params.product) args.product = params.product;
			if (params.lowStockOnly) args.lowStockOnly = true;
			const step = createReadStep('stock_snapshot', 'get_stock', args, 'retrieve_stock_levels');
			if (!step) return null;
			steps.push(step);
			break;
		}
		case 'products_catalog': {
			const args = {};
			if (params.product) args.product = params.product;
			if (params.category) args.category = params.category;
			const step = createReadStep('products_catalog', 'get_products', args, 'retrieve_product_catalog');
			if (!step) return null;
			steps.push(step);
			break;
		}
		case 'debts_snapshot': {
			const args = {};
			if (params.status) args.status = params.status;
			if (params.debtor) args.debtor = params.debtor;
			if (goal.period?.legacyPeriodId) args.period = goal.period.legacyPeriodId;
			const step = createReadStep('debts_snapshot', 'get_debts', args, 'retrieve_debts');
			if (!step) return null;
			steps.push(step);
			break;
		}
		case 'activity_summary': {
			const args = { period: periods.current };
			const step = createReadStep('activity_summary', 'generate_report', args, 'retrieve_activity_summary');
			if (!step) return null;
			steps.push(step);
			break;
		}
		case 'expense_write_proposal': {
			if (!getToolDefinition('create_expense')?.implemented) return null;
			steps.push({
				id: 'expense_proposal',
				tool: 'create_expense',
				arguments: {
					label: params.label ?? null,
					amount: params.amount ?? null,
					confirmed: false,
				},
				dependsOn: [],
				purpose: 'propose_expense',
				readOnly: false,
			});
			break;
		}
		case 'sale_write_proposal': {
			if (!getToolDefinition('create_sale')?.implemented) return null;
			steps.push({
				id: 'sale_proposal',
				tool: 'create_sale',
				arguments: {
					product: params.product ?? null,
					quantity: params.quantity ?? null,
					unitPrice: params.unitPrice ?? null,
					amountPaid: params.amountPaid ?? null,
					confirmed: false,
				},
				dependsOn: [],
				purpose: 'propose_sale',
				readOnly: false,
			});
			break;
		}
		default:
			return null;
		}
	}

	return steps;
}

/**
 * Build a validated AnalysisPlan from a normalized Goal.
 * Deterministic — no LLM involvement.
 */
export function buildAnalysisPlanFromGoal(rawGoal, context = {}, options = {}) {
	const goalResult = validateGoal(rawGoal, { rejectWriteExecution: true });
	if (!goalResult.valid) {
		return { success: false, reason: 'INVALID_GOAL', error: goalResult.error };
	}

	const goal = goalResult.value;
	const evidence = requiredEvidenceForGoal(goal);
	if (!evidence || evidence.length === 0) {
		return { success: false, reason: 'UNSUPPORTED_GOAL' };
	}

	const steps = buildStepsFromEvidence(evidence, goal, context);
	if (!steps || steps.length === 0) {
		return { success: false, reason: 'UNSUPPORTED_GOAL' };
	}

	const requiresConfirmation = steps.some((step) => !step.readOnly);
	const planDraft = {
		goal,
		steps,
		requiresConfirmation,
	};

	const validated = validateAnalysisPlanExtended(planDraft, options);
	if (!validated.valid) {
		return { success: false, reason: 'INVALID_PLAN', error: validated.error };
	}

	return {
		success: true,
		plan: validated.value,
		evidence,
	};
}
