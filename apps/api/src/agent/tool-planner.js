/**
 * Maps a resolved intent to a generic tool execution plan.
 * The agent executes plans — it is not hard-coded around get_sales only.
 */

export const PLANNED_READ_TOOLS = Object.freeze({
	query_stock: 'get_stock',
	query_products: 'get_products',
	query_debts: 'get_debts',
	generate_report: 'generate_report',
});

export const PLANNED_WRITE_TOOLS = Object.freeze({
	create_sale: 'create_sale',
	create_expense: 'create_expense',
	update_sale: 'update_sale',
	update_expense: 'update_expense',
	adjust_stock: 'adjust_stock',
});

function createStep(tool, input = {}, postProcess = null) {
	return {
		tool,
		input,
		...(postProcess ? { postProcess } : {}),
	};
}

function createReadPlan({ steps, responseKind, referenceUpdate = null }) {
	return {
		steps,
		responseKind,
		referenceUpdate,
	};
}

function createUnimplementedPlan(toolName, responseKind = 'unimplemented_topic') {
	return {
		steps: [],
		responseKind,
		unimplementedTool: toolName,
		referenceUpdate: null,
	};
}

function createEmptyPlan(responseKind = 'unknown') {
	return {
		steps: [],
		responseKind,
		referenceUpdate: null,
	};
}

function periodReferenceUpdate(entity) {
	return { type: 'period', entity };
}

function buildPeriodReadInput(resolved, extra = {}) {
	return {
		period: resolved.filters?.period || 'current_month',
		...extra,
	};
}

export function planToolExecution(resolved) {
	const intent = resolved?.intent;

	if (intent === 'query_sales') {
		return createReadPlan({
			steps: [createStep('get_sales', buildPeriodReadInput(resolved, {
				...(resolved.filters?.product ? { product: resolved.filters.product } : {}),
			}))],
			responseKind: 'query_sales',
			referenceUpdate: periodReferenceUpdate(resolved.topic || 'sales'),
		});
	}

	if (intent === 'query_expenses') {
		return createReadPlan({
			steps: [createStep('get_expenses', buildPeriodReadInput(resolved, {
				...(resolved.filters?.category ? { category: resolved.filters.category } : {}),
			}))],
			responseKind: 'query_expenses',
			referenceUpdate: periodReferenceUpdate(resolved.topic || 'expenses'),
		});
	}

	if (intent === 'compare_sales') {
		const periods = resolved.filters?.periods || ['current_month', 'previous_month'];
		return createReadPlan({
			steps: periods.map((period) => createStep('get_sales', { period })),
			responseKind: 'compare_sales',
		});
	}

	if (intent === 'compare_expenses') {
		const periods = resolved.filters?.periods || ['current_month', 'previous_month'];
		return createReadPlan({
			steps: periods.map((period) => createStep('get_expenses', { period })),
			responseKind: 'compare_expenses',
		});
	}

	if (intent === 'best_product') {
		return createReadPlan({
			steps: [createStep('get_sales', buildPeriodReadInput(resolved), 'best_product')],
			responseKind: 'best_product',
			referenceUpdate: periodReferenceUpdate(resolved.topic || 'sales'),
		});
	}

	if (PLANNED_READ_TOOLS[intent]) {
		return createUnimplementedPlan(PLANNED_READ_TOOLS[intent]);
	}

	if (PLANNED_WRITE_TOOLS[intent]) {
		return createUnimplementedPlan(PLANNED_WRITE_TOOLS[intent], 'unimplemented_write');
	}

	return createEmptyPlan();
}

export function primaryToolForIntent(intent) {
	if (intent === 'query_sales' || intent === 'compare_sales' || intent === 'best_product') {
		return 'get_sales';
	}
	if (intent === 'query_expenses' || intent === 'compare_expenses') {
		return 'get_expenses';
	}
	return PLANNED_READ_TOOLS[intent] || PLANNED_WRITE_TOOLS[intent] || null;
}
