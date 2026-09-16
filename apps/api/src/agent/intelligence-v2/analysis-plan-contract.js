import { validateGoal } from './goal-contract.js';
import { validatePlanSteps } from './plan-step-contract.js';

export function validateAnalysisPlan(raw) {
	if (!raw || typeof raw !== 'object') {
		return { valid: false, error: 'PLAN_INVALID' };
	}

	const goalResult = validateGoal(raw.goal, { rejectWriteExecution: true });
	if (!goalResult.valid) {
		return { valid: false, error: goalResult.error };
	}

	const requiresConfirmation = Boolean(raw.requiresConfirmation);
	const stepsResult = validatePlanSteps(raw.steps || [], { planRequiresConfirmation: requiresConfirmation });
	if (!stepsResult.valid) {
		return { valid: false, error: stepsResult.error };
	}

	const hasWriteStep = stepsResult.value.some((step) => !step.readOnly);
	if (hasWriteStep && !requiresConfirmation) {
		return { valid: false, error: 'PLAN_WRITE_REQUIRES_CONFIRMATION' };
	}

	return {
		valid: true,
		value: {
			goal: goalResult.value,
			steps: stepsResult.value,
			requiresConfirmation,
		},
	};
}

export function createAnalysisPlan(goal, steps = [], requiresConfirmation = false) {
	return validateAnalysisPlan({
		goal,
		steps,
		requiresConfirmation,
	});
}

/** AnalysisPlan describes intent — never financial truth. */
export function assertPlanIsNotFinancialTruth(plan) {
	if (!plan) return true;
	const serialized = JSON.stringify(plan).toLowerCase();
	const forbidden = ['totalrevenue', 'estimatedprofit', 'totalcollected', 'totalamount'];
	return !forbidden.some((key) => serialized.includes(key));
}
