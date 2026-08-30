import assert from 'node:assert/strict';
import test from 'node:test';

import { runCreateExpense, validateCreateExpenseInput } from '../src/tools/create-expense.js';
import {
	normalizeCreateExpenseInput,
	setCreateExpenseImplForTests,
	resetCreateExpenseImplForTests,
} from '../src/services/expenses-write-service.js';

const USER = {
	id: 'pb_user',
	clientId: 'client_1',
	businessUserId: 'rec_user',
};

const EXPENSE_RESULT = {
	expenseId: 'expense-abc',
	label: 'transport',
	amount: 20,
};

test.afterEach(() => {
	resetCreateExpenseImplForTests();
});

test('valid confirmed expense returns success summary', async () => {
	setCreateExpenseImplForTests(async (clientId, input) => {
		assert.equal(clientId, 'client_1');
		assert.equal(input.label, 'transport');
		assert.equal(input.amount, 20);
		assert.equal(input.confirmed, true);
		return EXPENSE_RESULT;
	});

	const result = await runCreateExpense(
		{ user: USER },
		{
			label: 'transport',
			amount: 20,
			confirmed: true,
		},
	);

	assert.equal(result.success, true);
	assert.equal(result.tool, 'create_expense');
	assert.equal(result.data.summary.expenseId, 'expense-abc');
	assert.equal(result.data.summary.amount, 20);
});

test('unconfirmed expense returns NEEDS_CONFIRMATION with preview', async () => {
	const result = await runCreateExpense(
		{ user: USER },
		{
			label: 'transport',
			amount: 20,
			confirmed: false,
		},
	);

	assert.equal(result.success, false);
	assert.equal(result.error.code, 'NEEDS_CONFIRMATION');
	assert.equal(result.meta.requiresConfirmation, true);
	assert.equal(result.meta.preview.label, 'transport');
	assert.equal(result.meta.preview.amount, 20);
	assert.equal(result.data, null);
});

test('invalid amount is rejected', async () => {
	const result = await runCreateExpense(
		{ user: USER },
		{ label: 'transport', amount: 0, confirmed: true },
	);
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'INVALID_PARAMETER');
});

test('missing label is rejected', async () => {
	const result = await runCreateExpense(
		{ user: USER },
		{ amount: 20, confirmed: true },
	);
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'MISSING_LABEL');
});

test('forbidden clientId parameter is rejected', async () => {
	const result = await runCreateExpense(
		{ user: USER },
		{
			label: 'transport',
			amount: 20,
			confirmed: true,
			clientId: 'other_client',
		},
	);
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'FORBIDDEN_PARAMETER');
});

test('missing client scope returns structured error', async () => {
	const result = await runCreateExpense(
		{ user: { id: 'pb_x' } },
		{
			label: 'transport',
			amount: 20,
			confirmed: true,
		},
	);
	assert.equal(result.success, false);
	assert.equal(result.error.code, 'CLIENT_SCOPE_MISSING');
});

test('normalizeCreateExpenseInput accepts French aliases', () => {
	const normalized = normalizeCreateExpenseInput({
		libelle: 'Loyer',
		montant_total: 150,
	});
	assert.deepEqual(normalized, {
		label: 'Loyer',
		amount: 150,
		confirmed: false,
	});
});

test('validateCreateExpenseInput rejects userId', () => {
	assert.throws(
		() => validateCreateExpenseInput({ userId: 'x', label: 'transport', amount: 20 }),
		/Forbidden parameter for create_expense: userId/,
	);
});

test('error result never exposes data payload', async () => {
	setCreateExpenseImplForTests(async () => {
		const error = new Error('db down');
		error.code = 'SUPABASE_RPC_FAILED';
		throw error;
	});

	const result = await runCreateExpense(
		{ user: USER },
		{
			label: 'transport',
			amount: 20,
			confirmed: true,
		},
	);

	assert.equal(result.success, false);
	assert.equal(result.data, null);
});
