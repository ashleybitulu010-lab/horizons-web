export function successToolResult(tool, data, meta = {}) {
	return normalizeToolResult({
		success: true,
		tool,
		data,
		meta,
		error: null,
	});
}

export function errorToolResult(tool, code, message, meta = {}) {
	return normalizeToolResult({
		success: false,
		tool,
		data: null,
		meta,
		error: {
			code,
			message,
		},
	});
}

export function normalizeToolResult(result) {
	if (!result || typeof result !== 'object') {
		return result;
	}

	const success = Boolean(result.success);
	return {
		success,
		tool: result.tool,
		data: success ? (result.data ?? null) : null,
		meta: result.meta ?? {},
		error: success ? null : (result.error ?? {
			code: 'UNKNOWN_ERROR',
			message: 'Tool execution failed',
		}),
	};
}

export function assertToolResultShape(result) {
	const normalized = normalizeToolResult(result);
	if (typeof normalized.success !== 'boolean') throw new Error('ToolResult.success must be boolean');
	if (typeof normalized.tool !== 'string') throw new Error('ToolResult.tool must be string');
	if (normalized.success && normalized.data == null) throw new Error('Successful ToolResult requires data');
	if (!normalized.success && normalized.data !== null) throw new Error('Failed ToolResult must set data to null');
	if (normalized.success && normalized.error !== null) throw new Error('Successful ToolResult requires error null');
	if (!normalized.success && !normalized.error) throw new Error('Failed ToolResult requires error object');
	return normalized;
}

const TOOL_RESOURCE_LABELS = Object.freeze({
	get_sales: 'sales',
	get_expenses: 'expenses',
	get_stock: 'stock',
	get_debts: 'debts',
	get_products: 'products',
	generate_report: 'report',
	create_sale: 'sale',
});

function resourceLabel(tool) {
	return TOOL_RESOURCE_LABELS[tool] || 'data';
}
export function mapServiceError(tool, err) {
	if (err?.code === 'SUPABASE_CLIENT_SCOPE_MISSING') {
		return errorToolResult(tool, 'CLIENT_SCOPE_MISSING', 'No Supabase client scope is available for this user');
	}
	if (err?.code === 'INVALID_PERIOD') {
		return errorToolResult(tool, 'INVALID_PERIOD', err.message);
	}
	if (err?.code === 'INVALID_DATE_RANGE') {
		return errorToolResult(tool, 'INVALID_DATE_RANGE', err.message);
	}
	if (err?.code === 'SUPABASE_QUERY_FAILED') {
		return errorToolResult(tool, 'SUPABASE_ERROR', `Unable to retrieve ${resourceLabel(tool)} data`);
	}
	return errorToolResult(tool, 'INTERNAL_ERROR', `Unable to complete the ${resourceLabel(tool)} request`);
}
