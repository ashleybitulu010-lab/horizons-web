import { TOOL_NAMES } from '../../tools/definitions.js';
import {
	FORBIDDEN_GOAL_KEYS,
	SQL_INJECTION_PATTERN,
	UUID_PATTERN,
} from './constants.js';

const WRITE_TOOLS = Object.freeze(['create_sale', 'create_expense']);
const READ_TOOLS = Object.freeze([
	'get_sales',
	'get_expenses',
	'get_stock',
	'get_products',
	'get_debts',
	'generate_report',
]);

const ALLOWED_ARGUMENT_KEYS = Object.freeze([
	'period',
	'periods',
	'startDate',
	'endDate',
	'product',
	'category',
	'lowStockOnly',
	'status',
	'debtor',
	'limit',
	'order',
	'label',
	'amount',
	'quantity',
	'unitPrice',
	'amountPaid',
	'confirmed',
]);

const STEP_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function containsForbiddenPayload(value) {
	const serialized = JSON.stringify(value);
	if (SQL_INJECTION_PATTERN.test(serialized)) {
		return 'SQL_FORBIDDEN';
	}

	for (const key of FORBIDDEN_GOAL_KEYS) {
		if (Object.prototype.hasOwnProperty.call(value, key)) {
			return 'FORBIDDEN_KEY';
		}
	}

	return null;
}

export function isWriteToolName(tool) {
	return WRITE_TOOLS.includes(tool);
}

export function isReadToolName(tool) {
	return READ_TOOLS.includes(tool);
}

export function validatePlanStep(raw, options = {}) {
	if (!raw || typeof raw !== 'object') {
		return { valid: false, error: 'STEP_INVALID' };
	}

	if (raw.arguments) {
		const forbidden = containsForbiddenPayload(raw.arguments);
		if (forbidden) {
			return { valid: false, error: forbidden };
		}
	}

	if (raw.purpose) {
		const forbidden = containsForbiddenPayload({ note: String(raw.purpose) });
		if (forbidden) {
			return { valid: false, error: forbidden };
		}
	}

	const id = String(raw.id || '');
	if (!STEP_ID_PATTERN.test(id)) {
		return { valid: false, error: 'STEP_ID_INVALID' };
	}

	const tool = String(raw.tool || '');
	if (!TOOL_NAMES.includes(tool)) {
		return { valid: false, error: 'STEP_TOOL_UNKNOWN' };
	}

	if (!isReadToolName(tool) && !isWriteToolName(tool)) {
		return { valid: false, error: 'STEP_TOOL_NOT_IMPLEMENTED' };
	}

	const readOnly = raw.readOnly !== false && !isWriteToolName(tool);
	if (isWriteToolName(tool) && readOnly) {
		return { valid: false, error: 'STEP_WRITE_MUST_NOT_BE_READONLY' };
	}

	if (isWriteToolName(tool) && !options.planRequiresConfirmation) {
		return { valid: false, error: 'STEP_WRITE_REQUIRES_CONFIRMATION' };
	}

	const dependsOn = Array.isArray(raw.dependsOn)
		? raw.dependsOn.map((dep) => String(dep))
		: [];

	const purpose = raw.purpose == null ? null : String(raw.purpose).slice(0, 128);

	const argumentsObj = {};
	if (raw.arguments && typeof raw.arguments === 'object' && !Array.isArray(raw.arguments)) {
		for (const [key, value] of Object.entries(raw.arguments)) {
			if (!ALLOWED_ARGUMENT_KEYS.includes(key)) {
				return { valid: false, error: 'STEP_ARGUMENT_FORBIDDEN' };
			}
			if (FORBIDDEN_GOAL_KEYS.includes(key)) {
				return { valid: false, error: 'STEP_FORBIDDEN_KEY' };
			}
			if (typeof value === 'string' && UUID_PATTERN.test(value)) {
				return { valid: false, error: 'STEP_UUID_NOT_ALLOWED' };
			}
			argumentsObj[key] = value;
		}
	}

	if (isWriteToolName(tool) && argumentsObj.confirmed === true && !options.planRequiresConfirmation) {
		return { valid: false, error: 'STEP_WRITE_CONFIRMED_WITHOUT_GATE' };
	}

	return {
		valid: true,
		value: {
			id,
			tool,
			arguments: argumentsObj,
			dependsOn,
			purpose,
			readOnly,
		},
	};
}

export function validatePlanSteps(steps, options = {}) {
	if (!Array.isArray(steps)) {
		return { valid: false, error: 'STEPS_NOT_ARRAY' };
	}

	const normalized = [];
	const ids = new Set();

	for (const step of steps) {
		const result = validatePlanStep(step, options);
		if (!result.valid) {
			return result;
		}
		if (ids.has(result.value.id)) {
			return { valid: false, error: 'STEP_ID_DUPLICATE' };
		}
		ids.add(result.value.id);
		normalized.push(result.value);
	}

	for (const step of normalized) {
		for (const dep of step.dependsOn) {
			if (!ids.has(dep)) {
				return { valid: false, error: 'STEP_DEPENDENCY_UNKNOWN' };
			}
		}
	}

	return { valid: true, value: normalized };
}
