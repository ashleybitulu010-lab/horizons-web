import { getProducts } from '../services/products-service.js';
import { errorToolResult, mapServiceError, successToolResult } from '../utils/tool-result.js';
import { assertNoIdentityParams } from './validation.js';

export const GET_PRODUCTS_TOOL = 'get_products';

export function validateGetProductsInput(input = {}) {
	return assertNoIdentityParams(input, GET_PRODUCTS_TOOL);
}

export async function runGetProducts(context, input = {}, referenceDate = new Date()) {
	const tool = GET_PRODUCTS_TOOL;

	try {
		if (!context?.user?.id) {
			return errorToolResult(tool, 'UNAUTHENTICATED', 'Authenticated user context is required');
		}

		validateGetProductsInput(input);
		const result = await getProducts(context.user, input, referenceDate);

		return successToolResult(tool, {
			summary: result.summary,
			products: result.products,
		}, {
			product: result.input.product || null,
			category: result.input.category || null,
			order: result.input.order,
			count: result.summary.count,
		});
	} catch (err) {
		if (err?.code === 'FORBIDDEN_PARAMETER') {
			return errorToolResult(tool, 'FORBIDDEN_PARAMETER', err.message);
		}
		return mapServiceError(tool, err);
	}
}
