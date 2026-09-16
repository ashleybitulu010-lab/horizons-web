import { validateAnalysisPlan } from './analysis-plan-contract.js';

export const DEFAULT_MAX_PLAN_STEPS = 12;

function stepSignature(step) {
	return `${step.tool}::${JSON.stringify(step.arguments || {})}`;
}

function detectDuplicateSteps(steps) {
	const seen = new Map();
	for (const step of steps) {
		const signature = stepSignature(step);
		if (seen.has(signature)) {
			return {
				valid: false,
				error: 'PLAN_DUPLICATE_STEP',
				duplicateIds: [seen.get(signature), step.id],
			};
		}
		seen.set(signature, step.id);
	}
	return { valid: true };
}

function detectDependencyCycle(steps) {
	const graph = new Map(steps.map((step) => [step.id, step.dependsOn || []]));
	const visiting = new Set();
	const visited = new Set();

	function dfs(nodeId) {
		if (visiting.has(nodeId)) {
			return false;
		}
		if (visited.has(nodeId)) {
			return true;
		}

		visiting.add(nodeId);
		for (const dep of graph.get(nodeId) || []) {
			if (!graph.has(dep) || !dfs(dep)) {
				return false;
			}
		}
		visiting.delete(nodeId);
		visited.add(nodeId);
		return true;
	}

	for (const stepId of graph.keys()) {
		if (!dfs(stepId)) {
			return { valid: false, error: 'INVALID_PLAN_CYCLE' };
		}
	}

	return { valid: true };
}

/**
 * Extended plan validation: base contract + step limit + duplicates + cycles.
 */
export function validateAnalysisPlanExtended(raw, options = {}) {
	const maxSteps = options.maxSteps ?? DEFAULT_MAX_PLAN_STEPS;
	const base = validateAnalysisPlan(raw);

	if (!base.valid) {
		return base;
	}

	if (base.value.steps.length > maxSteps) {
		return { valid: false, error: 'PLAN_TOO_MANY_STEPS' };
	}

	const duplicateCheck = detectDuplicateSteps(base.value.steps);
	if (!duplicateCheck.valid) {
		return duplicateCheck;
	}

	const cycleCheck = detectDependencyCycle(base.value.steps);
	if (!cycleCheck.valid) {
		return cycleCheck;
	}

	return base;
}
