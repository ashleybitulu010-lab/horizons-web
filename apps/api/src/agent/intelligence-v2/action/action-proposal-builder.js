import { sanitizeBusinessFieldValue } from '../business-field-sanitizer.js';
import { createEmptyGoal } from '../goal-contract.js';
import {
	ACTION_FIELD_KEYS,
	ACTION_PROPOSAL_STATUS,
	ACTION_TOOLS,
	ACTION_TYPE_TO_TOOL,
	ACTION_TYPES,
	buildPendingWriteDraft,
	createEmptyInternalActionProposal,
	validateInternalActionProposal,
} from './action-proposal-contract.js';

function parsePositiveNumber(value) {
	if (value == null || value === '') return null;
	const num = Number(String(value).replace(',', '.'));
	if (!Number.isFinite(num) || num <= 0) return null;
	return num;
}

function parseNonNegativeNumber(value) {
	if (value == null || value === '') return null;
	const num = Number(String(value).replace(',', '.'));
	if (!Number.isFinite(num) || num < 0) return null;
	return num;
}

function parseLabel(value) {
	const label = sanitizeBusinessFieldValue(String(value || '').trim());
	return label || null;
}

function parseProduct(value) {
	const product = sanitizeBusinessFieldValue(String(value || '').trim());
	return product || null;
}

function normalizeExpenseFields(raw = {}) {
	return {
		label: parseLabel(raw.label),
		amount: parsePositiveNumber(raw.amount),
	};
}

function normalizeSaleFields(raw = {}) {
	const fields = {
		product: parseProduct(raw.product),
		quantity: parsePositiveNumber(raw.quantity),
		unitPrice: parsePositiveNumber(raw.unitPrice),
		amountPaid: parseNonNegativeNumber(raw.amountPaid),
	};
	if (fields.amountPaid == null && fields.quantity != null && fields.unitPrice != null) {
		fields.amountPaid = fields.quantity * fields.unitPrice;
	}
	return fields;
}

function computeMissingExpenseFields(fields) {
	const missing = [];
	if (!fields.label) missing.push('label');
	if (fields.amount == null) missing.push('amount');
	return missing;
}

function computeMissingSaleFields(fields) {
	const missing = [];
	if (!fields.product) missing.push('product');
	if (fields.quantity == null) missing.push('quantity');
	if (fields.unitPrice == null) missing.push('unitPrice');
	if (fields.amountPaid == null) missing.push('amountPaid');
	return missing;
}

function buildExpenseClarificationPrompt(fields, missingFields) {
	if (missingFields.includes('label') && missingFields.includes('amount')) {
		return 'Pour quelle dépense et quel montant veux-tu que j’enregistre ?';
	}
	if (missingFields.includes('amount')) {
		return fields.label
			? `Quel montant pour la dépense « ${fields.label} » ?`
			: 'Quel montant pour cette dépense ?';
	}
	if (missingFields.includes('label')) {
		return 'Pour quoi est cette dépense ?';
	}
	return 'Il me manque des informations pour enregistrer cette dépense.';
}

function buildSaleClarificationPrompt(fields, missingFields) {
	if (missingFields.includes('product')) {
		return 'Quel produit as-tu vendu ?';
	}
	if (missingFields.includes('quantity')) {
		return fields.product
			? `Combien de ${fields.product} as-tu vendus ?`
			: 'Combien d’unités as-tu vendues ?';
	}
	if (missingFields.includes('unitPrice')) {
		return fields.product
			? `À quel prix unitaire pour ${fields.product} ?`
			: 'À quel prix unitaire ?';
	}
	if (missingFields.includes('amountPaid')) {
		if (fields.quantity != null && fields.product && fields.unitPrice != null) {
			return `Combien as-tu encaissé pour ${fields.quantity} ${fields.product} à ${fields.unitPrice} $ ?`;
		}
		return fields.product
			? `Combien as-tu encaissé pour cette vente de ${fields.product} ?`
			: 'Combien as-tu encaissé pour cette vente ?';
	}
	return 'Il me manque des informations pour enregistrer cette vente.';
}

function buildExpenseDescription(fields) {
	if (!fields.label && fields.amount == null) {
		return 'Enregistrer une dépense';
	}
	if (fields.label && fields.amount != null) {
		return `Enregistrer une dépense de ${fields.amount} $ pour « ${fields.label} »`;
	}
	if (fields.label) {
		return `Enregistrer une dépense pour « ${fields.label} »`;
	}
	return `Enregistrer une dépense de ${fields.amount} $`;
}

function buildSaleDescription(fields) {
	const parts = [];
	if (fields.quantity != null && fields.product) {
		parts.push(`${fields.quantity} ${fields.product}`);
	} else if (fields.product) {
		parts.push(fields.product);
	}
	if (fields.unitPrice != null) {
		parts.push(`à ${fields.unitPrice} $`);
	}
	if (fields.amountPaid != null) {
		parts.push(`encaissé ${fields.amountPaid} $`);
	}
	if (!parts.length) {
		return 'Enregistrer une vente';
	}
	return `Enregistrer ${parts.join(' ')}`;
}

function resolveActionTypeFromGoal(goal) {
	if (!goal || goal.type !== 'ACTION') {
		return null;
	}
	if (goal.domain === 'EXPENSES' && goal.objective === 'CREATE') {
		return ACTION_TYPES.CREATE_EXPENSE;
	}
	if (goal.domain === 'SALES' && goal.objective === 'CREATE') {
		return ACTION_TYPES.CREATE_SALE;
	}
	return null;
}

function resolveStatus({ missingFields, confirmed, deferred }) {
	if (deferred) {
		return ACTION_PROPOSAL_STATUS.DEFERRED;
	}
	if (missingFields.length > 0) {
		return ACTION_PROPOSAL_STATUS.NEEDS_CLARIFICATION;
	}
	if (confirmed) {
		return ACTION_PROPOSAL_STATUS.CONFIRMATION_ACCEPTED;
	}
	return ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION;
}

function buildProposalCore({
	actionType,
	fields,
	missingFields,
	confirmed = false,
	deferred = false,
	warnings = [],
	diagnostics = {},
}) {
	const tool = ACTION_TYPE_TO_TOOL[actionType];
	const status = resolveStatus({ missingFields, confirmed, deferred });
	const clarificationPrompt = missingFields.length > 0
		? (actionType === ACTION_TYPES.CREATE_EXPENSE
			? buildExpenseClarificationPrompt(fields, missingFields)
			: buildSaleClarificationPrompt(fields, missingFields))
		: null;
	const description = actionType === ACTION_TYPES.CREATE_EXPENSE
		? buildExpenseDescription(fields)
		: buildSaleDescription(fields);

	const draft = createEmptyInternalActionProposal({
		actionType,
		tool,
		status,
		fields,
		missingFields,
		warnings,
		description,
		confirmationRequired: status === ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION,
		clarificationPrompt,
		diagnostics,
	});

	if (missingFields.length === 0 && !deferred) {
		const pendingResult = buildPendingWriteDraft(draft);
		if (pendingResult.valid) {
			draft.pendingWrite = pendingResult.value;
		}
	}

	return validateInternalActionProposal(draft);
}

/**
 * Build InternalActionProposal from a validated ACTION goal.
 */
export function buildActionProposalFromGoal(goal, options = {}) {
	const actionType = resolveActionTypeFromGoal(goal);
	if (!actionType) {
		return {
			valid: false,
			error: 'GOAL_NOT_ACTION_CREATE',
		};
	}

	const params = goal.parameters || {};
	const confirmed = Boolean(params.confirmed);
	const deferred = Boolean(options.deferred);

	let fields;
	let missingFields;

	if (actionType === ACTION_TYPES.CREATE_EXPENSE) {
		fields = normalizeExpenseFields(params);
		missingFields = computeMissingExpenseFields(fields);
	} else {
		fields = normalizeSaleFields(params);
		missingFields = computeMissingSaleFields(fields);
	}

	return buildProposalCore({
		actionType,
		fields,
		missingFields,
		confirmed,
		deferred,
		warnings: Array.isArray(options.warnings) ? options.warnings : [],
		diagnostics: {
			source: 'goal',
			...(options.diagnostics || {}),
		},
	});
}

/**
 * Build InternalActionProposal from a plan write step (create_expense / create_sale).
 */
export function buildActionProposalFromPlanStep(step, options = {}) {
	if (!step?.tool) {
		return { valid: false, error: 'PLAN_STEP_INVALID' };
	}

	const actionType = step.tool === ACTION_TOOLS.CREATE_EXPENSE
		? ACTION_TYPES.CREATE_EXPENSE
		: step.tool === ACTION_TOOLS.CREATE_SALE
			? ACTION_TYPES.CREATE_SALE
			: null;

	if (!actionType) {
		return { valid: false, error: 'PLAN_STEP_NOT_WRITE' };
	}

	const args = step.arguments || step.input || {};
	const confirmed = Boolean(args.confirmed);
	const deferred = Boolean(options.deferred);

	let fields;
	let missingFields;

	if (actionType === ACTION_TYPES.CREATE_EXPENSE) {
		fields = normalizeExpenseFields(args);
		missingFields = computeMissingExpenseFields(fields);
	} else {
		fields = normalizeSaleFields(args);
		missingFields = computeMissingSaleFields(fields);
	}

	return buildProposalCore({
		actionType,
		fields,
		missingFields,
		confirmed,
		deferred,
		warnings: Array.isArray(options.warnings) ? options.warnings : [],
		diagnostics: {
			source: 'plan_step',
			stepId: step.id ?? null,
			...(options.diagnostics || {}),
		},
	});
}

/**
 * Build InternalActionProposal from legacy pendingWrite draft.
 */
export function buildActionProposalFromPendingWrite(pendingWrite, options = {}) {
	if (!pendingWrite?.tool) {
		return { valid: false, error: 'PENDING_WRITE_REQUIRED' };
	}

	const actionType = pendingWrite.tool === ACTION_TOOLS.CREATE_EXPENSE
		? ACTION_TYPES.CREATE_EXPENSE
		: pendingWrite.tool === ACTION_TOOLS.CREATE_SALE
			? ACTION_TYPES.CREATE_SALE
			: null;

	if (!actionType) {
		return { valid: false, error: 'PENDING_WRITE_TOOL_INVALID' };
	}

	const confirmed = Boolean(options.confirmed);
	const deferred = Boolean(options.deferred);

	let fields;
	let missingFields;

	if (actionType === ACTION_TYPES.CREATE_EXPENSE) {
		fields = normalizeExpenseFields(pendingWrite);
		missingFields = computeMissingExpenseFields(fields);
	} else {
		fields = normalizeSaleFields(pendingWrite);
		missingFields = computeMissingSaleFields(fields);
	}

	return buildProposalCore({
		actionType,
		fields,
		missingFields,
		confirmed,
		deferred,
		warnings: Array.isArray(options.warnings) ? options.warnings : [],
		diagnostics: {
			source: 'pending_write',
			...(options.diagnostics || {}),
		},
	});
}

/**
 * Convenience helper for tests and orchestrator wiring.
 */
export function buildExpenseActionGoal(parameters = {}) {
	return createEmptyGoal({
		type: 'ACTION',
		domain: 'EXPENSES',
		objective: 'CREATE',
		parameters,
	});
}

export function buildSaleActionGoal(parameters = {}) {
	return createEmptyGoal({
		type: 'ACTION',
		domain: 'SALES',
		objective: 'CREATE',
		parameters,
	});
}

export function getRequiredActionFields(actionType) {
	return [...(ACTION_FIELD_KEYS[actionType] || [])];
}
