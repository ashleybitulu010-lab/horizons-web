import {
	buildCreateExpensePreview,
	createExpenseForUser,
	normalizeCreateExpenseInput,
} from '../services/expenses-write-service.js';
import { errorToolResult, mapServiceError, successToolResult } from '../utils/tool-result.js';
import { assertNoIdentityParams } from './validation.js';

export const CREATE_EXPENSE_TOOL = 'create_expense';

export function validateCreateExpenseInput(input = {}) {
	assertNoIdentityParams(input, CREATE_EXPENSE_TOOL);
	return normalizeCreateExpenseInput(input);
}

export async function runCreateExpense(context, input = {}) {
	const tool = CREATE_EXPENSE_TOOL;
	let normalized;

	try {
		if (!context?.user?.id) {
			return errorToolResult(tool, 'UNAUTHENTICATED', 'Authenticated user context is required');
		}

		normalized = validateCreateExpenseInput(input);
		const result = await createExpenseForUser(context.user, normalized);

		if (result.status === 'needs_confirmation') {
			return errorToolResult(
				tool,
				'NEEDS_CONFIRMATION',
				'User confirmation is required before creating the expense',
				{
					preview: result.preview,
					requiresConfirmation: true,
				},
			);
		}

		const expense = result.expense;
		return successToolResult(tool, {
			summary: {
				expenseId: expense.expenseId,
				label: expense.label,
				amount: expense.amount,
			},
		}, {
			label: expense.label,
			amount: expense.amount,
		});
	} catch (err) {
		if (err?.code === 'FORBIDDEN_PARAMETER') {
			return errorToolResult(tool, 'FORBIDDEN_PARAMETER', err.message);
		}
		if (err?.code === 'MISSING_LABEL') {
			return errorToolResult(tool, 'MISSING_LABEL', err.message);
		}
		if (err?.code === 'MISSING_AMOUNT') {
			return errorToolResult(tool, 'MISSING_AMOUNT', err.message);
		}
		if (err?.code === 'INVALID_PARAMETER') {
			return errorToolResult(tool, 'INVALID_PARAMETER', err.message);
		}
		return mapServiceError(tool, err);
	}
}

export { buildCreateExpensePreview };
