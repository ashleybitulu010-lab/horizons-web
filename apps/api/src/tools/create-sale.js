import {
	buildCreateSalePreview,
	createSaleForUser,
	normalizeCreateSaleInput,
	refuseVenteStockMessage,
} from '../services/sales-write-service.js';
import { errorToolResult, mapServiceError, successToolResult } from '../utils/tool-result.js';
import { assertNoIdentityParams } from './validation.js';

export const CREATE_SALE_TOOL = 'create_sale';

export function validateCreateSaleInput(input = {}) {
	assertNoIdentityParams(input, CREATE_SALE_TOOL);
	return normalizeCreateSaleInput(input);
}

export async function runCreateSale(context, input = {}) {
	const tool = CREATE_SALE_TOOL;
	let normalized;

	try {
		if (!context?.user?.id) {
			return errorToolResult(tool, 'UNAUTHENTICATED', 'Authenticated user context is required');
		}

		normalized = validateCreateSaleInput(input);
		const result = await createSaleForUser(context.user, normalized);

		if (result.status === 'needs_confirmation') {
			return errorToolResult(
				tool,
				'NEEDS_CONFIRMATION',
				'User confirmation is required before creating the sale',
				{
					preview: result.preview,
					requiresConfirmation: true,
				},
			);
		}

		const sale = result.sale;
		return successToolResult(tool, {
			summary: {
				saleId: sale.saleId,
				product: sale.product,
				quantity: sale.quantity,
				unitPrice: sale.unitPrice,
				amountPaid: sale.amountPaid,
				total: sale.total,
				stockRemaining: sale.stockRemaining,
				stockAlert: sale.stockAlert || null,
			},
		}, {
			product: sale.product,
			quantity: sale.quantity,
			stockRemaining: sale.stockRemaining,
		});
	} catch (err) {
		if (err?.code === 'FORBIDDEN_PARAMETER') {
			return errorToolResult(tool, 'FORBIDDEN_PARAMETER', err.message);
		}
		if (err?.code === 'MISSING_PRODUCT') {
			return errorToolResult(tool, 'MISSING_PRODUCT', err.message);
		}
		if (err?.code === 'MISSING_UNIT_PRICE') {
			return errorToolResult(tool, 'MISSING_UNIT_PRICE', err.message);
		}
		if (err?.code === 'MISSING_AMOUNT_PAID') {
			return errorToolResult(tool, 'MISSING_AMOUNT_PAID', err.message);
		}
		if (err?.code === 'INVALID_PARAMETER') {
			return errorToolResult(tool, 'INVALID_PARAMETER', err.message);
		}
		if (err?.code === 'PRODUCT_NOT_FOUND') {
			return errorToolResult(tool, 'PRODUCT_NOT_FOUND', 'Product not found in catalogue');
		}
		if (err?.code === 'INSUFFICIENT_STOCK') {
			const available = err.available;
			const requested = err.requested ?? normalized?.quantity;
			const message = available != null
				? refuseVenteStockMessage(normalized?.product, available, requested)
				: err.message;
			return errorToolResult(tool, 'INSUFFICIENT_STOCK', message);
		}
		return mapServiceError(tool, err);
	}
}

export { buildCreateSalePreview };
