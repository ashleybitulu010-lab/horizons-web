import { getSales } from '../services/sales-service.js';
import { errorToolResult, mapServiceError, successToolResult } from '../utils/tool-result.js';

export const GET_SALES_TOOL = 'get_sales';

export function validateGetSalesInput(input = {}) {
	const forbiddenKeys = ['userId', 'clientId', 'client_id', 'user_id'];
	for (const key of forbiddenKeys) {
		if (input[key] != null && input[key] !== '') {
			const error = new Error(`Forbidden parameter: ${key}`);
			error.code = 'FORBIDDEN_PARAMETER';
			throw error;
		}
	}
	return input;
}

export async function runGetSales(context, input = {}, referenceDate = new Date()) {
	const tool = GET_SALES_TOOL;

	try {
		if (!context?.user?.id) {
			return errorToolResult(tool, 'UNAUTHENTICATED', 'Authenticated user context is required');
		}

		validateGetSalesInput(input);
		const result = await getSales(context.user, input, referenceDate);

		return successToolResult(tool, {
			summary: result.summary,
			sales: result.sales,
		}, {
			period: result.input.period || null,
			startDate: result.range.startDate,
			endDate: result.range.endDate,
			count: result.summary.count,
			timeZone: result.range.timeZone,
		});
	} catch (err) {
		if (err?.code === 'FORBIDDEN_PARAMETER') {
			return errorToolResult(tool, 'FORBIDDEN_PARAMETER', err.message);
		}
		return mapServiceError(tool, err);
	}
}
