import { isWriteToolName } from '../plan-step-contract.js';

export function assertShadowReadOnlyTool(toolName) {
	if (isWriteToolName(toolName)) {
		const err = new Error(`Shadow write blocked for tool: ${toolName}`);
		err.code = 'SHADOW_WRITE_BLOCKED';
		throw err;
	}
}

export function filterShadowReadOnlySteps(steps = []) {
	return steps.filter((step) => !isWriteToolName(step.tool));
}

export function hasWriteTools(steps = []) {
	return steps.some((step) => isWriteToolName(step.tool));
}
