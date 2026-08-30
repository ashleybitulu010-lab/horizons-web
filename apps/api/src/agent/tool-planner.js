/**
 * Maps a resolved intent to a generic tool execution plan.
 * The agent executes plans — it is not hard-coded around get_sales only.
 */

export const PLANNED_READ_TOOLS = Object.freeze({});

export const PLANNED_WRITE_TOOLS = Object.freeze({
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

function stockReferenceUpdate() {
	return { type: 'stock', entity: 'stock' };
}

function buildStockInput(resolved) {
	return {
		...(resolved.filters?.product ? { product: resolved.filters.product } : {}),
		...(resolved.filters?.lowStockOnly ? { lowStockOnly: true } : {}),
	};
}

function buildDebtsInput(resolved) {
	return {
		...(resolved.filters?.period ? { period: resolved.filters.period } : {}),
		...(resolved.filters?.status ? { status: resolved.filters.status } : { status: 'unpaid' }),
		...(resolved.filters?.debtor ? { debtor: resolved.filters.debtor } : {}),
	};
}

function debtsReferenceUpdate() {
	return { type: 'debts', entity: 'debts' };
}

function productsReferenceUpdate() {
	return { type: 'products', entity: 'products' };
}

function buildProductsInput(resolved) {
	return {
		...(resolved.filters?.product ? { product: resolved.filters.product } : {}),
		...(resolved.filters?.category ? { category: resolved.filters.category } : {}),
	};
}

function reportReferenceUpdate() {
	return { type: 'report', entity: 'report' };
}

function buildReportInput(resolved) {
	const filters = resolved.filters || {};
	if (filters.period) {
		return { period: filters.period };
	}
	if (filters.startDate && filters.endDate) {
		return {
			startDate: filters.startDate,
			endDate: filters.endDate,
		};
	}
	return { period: 'current_month' };
}

function buildCreateSaleInput(resolved) {
	const filters = resolved.filters || {};
	return {
		product: filters.product || null,
		quantity: filters.quantity ?? null,
		unitPrice: filters.unitPrice ?? null,
		amountPaid: filters.amountPaid ?? null,
		confirmed: Boolean(filters.confirmed),
	};
}

function buildCreateExpenseInput(resolved) {
	const filters = resolved.filters || {};
	return {
		label: filters.label || null,
		amount: filters.amount ?? null,
		confirmed: Boolean(filters.confirmed),
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

	if (intent === 'query_stock') {
		return createReadPlan({
			steps: [createStep('get_stock', buildStockInput(resolved))],
			responseKind: resolved.filters?.lowStockOnly ? 'low_stock' : 'query_stock',
			referenceUpdate: stockReferenceUpdate(),
		});
	}

	if (intent === 'query_debts') {
		return createReadPlan({
			steps: [createStep('get_debts', buildDebtsInput(resolved))],
			responseKind: 'query_debts',
			referenceUpdate: debtsReferenceUpdate(),
		});
	}

	if (intent === 'query_products') {
		return createReadPlan({
			steps: [createStep('get_products', buildProductsInput(resolved))],
			responseKind: 'query_products',
			referenceUpdate: productsReferenceUpdate(),
		});
	}

	if (intent === 'generate_report') {
		return createReadPlan({
			steps: [createStep('generate_report', buildReportInput(resolved))],
			responseKind: 'generate_report',
			referenceUpdate: reportReferenceUpdate(),
		});
	}

	if (intent === 'create_sale') {
		return createReadPlan({
			steps: [createStep('create_sale', buildCreateSaleInput(resolved))],
			responseKind: 'create_sale',
			referenceUpdate: null,
		});
	}

	if (intent === 'create_expense') {
		return createReadPlan({
			steps: [createStep('create_expense', buildCreateExpenseInput(resolved))],
			responseKind: 'create_expense',
			referenceUpdate: null,
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

	if (intent === 'compare_sales_expenses') {
		const period = resolved.filters?.period || 'current_month';
		return createReadPlan({
			steps: [
				createStep('get_sales', { period }),
				createStep('get_expenses', { period }),
			],
			responseKind: 'compare_sales_expenses',
			referenceUpdate: periodReferenceUpdate('mixed'),
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
	if (intent === 'query_stock') {
		return 'get_stock';
	}
	if (intent === 'query_debts') {
		return 'get_debts';
	}
	if (intent === 'query_products') {
		return 'get_products';
	}
	if (intent === 'generate_report') {
		return 'generate_report';
	}
	if (intent === 'create_sale') {
		return 'create_sale';
	}
	if (intent === 'create_expense') {
		return 'create_expense';
	}
	if (intent === 'compare_sales_expenses') {
		return null;
	}
	return PLANNED_READ_TOOLS[intent] || PLANNED_WRITE_TOOLS[intent] || null;
}
