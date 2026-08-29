import { getDebts } from '../services/debts-service.js';
import { errorToolResult, mapServiceError, successToolResult } from '../utils/tool-result.js';
import { assertNoIdentityParams } from './validation.js';

export const GET_DEBTS_TOOL = 'get_debts';

export function validateGetDebtsInput(input = {}) {
	return assertNoIdentityParams(input, GET_DEBTS_TOOL);
}

export async function runGetDebts(context, input = {}, referenceDate = new Date()) {
	const tool = GET_DEBTS_TOOL;

	try {
		if (!context?.user?.id) {
			return errorToolResult(tool, 'UNAUTHENTICATED', 'Authenticated user context is required');
		}

		validateGetDebtsInput(input);
		const result = await getDebts(context.user, input, referenceDate);

		return successToolResult(tool, {
			summary: result.summary,
			debts: result.debts,
		}, {
			period: result.input.period || null,
			status: result.input.status,
			startDate: result.range?.startDate || null,
			endDate: result.range?.endDate || null,
			count: result.summary.count,
			timeZone: result.range?.timeZone || null,
		});
	} catch (err) {
		if (err?.code === 'FORBIDDEN_PARAMETER') {
			return errorToolResult(tool, 'FORBIDDEN_PARAMETER', err.message);
		}
		return mapServiceError(tool, err);
	}
}
