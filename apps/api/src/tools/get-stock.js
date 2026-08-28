import { getStock } from '../services/stock-service.js';
import { errorToolResult, mapServiceError, successToolResult } from '../utils/tool-result.js';
import { assertNoIdentityParams } from './validation.js';

export const GET_STOCK_TOOL = 'get_stock';

export function validateGetStockInput(input = {}) {
	return assertNoIdentityParams(input, GET_STOCK_TOOL);
}

export async function runGetStock(context, input = {}, referenceDate = new Date()) {
	const tool = GET_STOCK_TOOL;

	try {
		if (!context?.user?.id) {
			return errorToolResult(tool, 'UNAUTHENTICATED', 'Authenticated user context is required');
		}

		validateGetStockInput(input);
		const result = await getStock(context.user, input);

		return successToolResult(tool, {
			summary: result.summary,
			items: result.items,
		}, {
			product: result.input.product || null,
			lowStockOnly: result.input.lowStockOnly,
			count: result.summary.count,
		});
	} catch (err) {
		if (err?.code === 'FORBIDDEN_PARAMETER') {
			return errorToolResult(tool, 'FORBIDDEN_PARAMETER', err.message);
		}
		return mapServiceError(tool, err);
	}
}
