import { getExpenses } from '../services/expenses-service.js';
import { errorToolResult, mapServiceError, successToolResult } from '../utils/tool-result.js';
import { assertNoIdentityParams } from './validation.js';

export const GET_EXPENSES_TOOL = 'get_expenses';

export function validateGetExpensesInput(input = {}) {
	return assertNoIdentityParams(input, GET_EXPENSES_TOOL);
}

export async function runGetExpenses(context, input = {}, referenceDate = new Date()) {
	const tool = GET_EXPENSES_TOOL;

	try {
		if (!context?.user?.id) {
			return errorToolResult(tool, 'UNAUTHENTICATED', 'Authenticated user context is required');
		}

		validateGetExpensesInput(input);
		const result = await getExpenses(context.user, input, referenceDate);

		return successToolResult(tool, {
			summary: result.summary,
			expenses: result.expenses,
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
