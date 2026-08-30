import { getSupabaseAdmin } from '../supabase/client.js';
import { isSupabaseConfigured } from '../config/env.js';
import { requireClientScope } from './supabase-scoped.js';

export const CREATE_EXPENSE_RPC = 'create_expense_atomic';

let createExpenseImpl = null;

export function setCreateExpenseImplForTests(impl) {
	createExpenseImpl = impl;
}

export function resetCreateExpenseImplForTests() {
	createExpenseImpl = null;
}

function parsePositiveAmount(value, fieldName = 'amount') {
	const num = Number(value);
	if (!Number.isFinite(num) || num <= 0) {
		const error = new Error(`${fieldName} must be a positive number`);
		error.code = 'INVALID_PARAMETER';
		throw error;
	}
	return num;
}

export function normalizeCreateExpenseInput(raw = {}) {
	const label = String(raw.label || raw.libelle || raw.libelle_depense || '').trim();
	if (!label) {
		const error = new Error('label is required');
		error.code = 'MISSING_LABEL';
		throw error;
	}

	return {
		label,
		amount: raw.amount !== undefined || raw.montant !== undefined || raw.montant_total !== undefined
			? parsePositiveAmount(raw.amount ?? raw.montant ?? raw.montant_total)
			: null,
		confirmed: Boolean(raw.confirmed),
	};
}

function mapRpcError(err) {
	const message = String(err?.message || err || '');

	if (/label required/i.test(message)) {
		const error = new Error(message);
		error.code = 'MISSING_LABEL';
		return error;
	}
	if (/amount must be positive/i.test(message)) {
		const error = new Error(message);
		error.code = 'INVALID_PARAMETER';
		return error;
	}

	const error = new Error(message || 'create_expense_atomic failed');
	error.code = 'SUPABASE_RPC_FAILED';
	return error;
}

async function defaultCreateExpense(clientId, input) {
	if (!isSupabaseConfigured()) {
		const error = new Error('Supabase is not configured');
		error.code = 'SUPABASE_NOT_CONFIGURED';
		throw error;
	}

	const admin = getSupabaseAdmin();
	if (!admin) {
		const error = new Error('Supabase admin client unavailable');
		error.code = 'SUPABASE_NOT_CONFIGURED';
		throw error;
	}

	const { data, error } = await admin.rpc(CREATE_EXPENSE_RPC, {
		p_client_id: clientId,
		p_label: input.label,
		p_amount: input.amount,
	});

	if (error) {
		throw mapRpcError(error);
	}

	if (!data?.ok) {
		const failure = new Error('create_expense_atomic returned unsuccessful result');
		failure.code = 'SUPABASE_RPC_FAILED';
		throw failure;
	}

	return {
		expenseId: data.expenseId,
		label: data.label || input.label,
		amount: Number(data.amount) || input.amount,
	};
}

export function buildCreateExpensePreview(input) {
	return {
		label: input.label,
		amount: input.amount,
	};
}

export async function createExpenseForUser(user, rawInput = {}) {
	const clientId = requireClientScope(user);
	const input = normalizeCreateExpenseInput(rawInput);

	if (!input.confirmed) {
		if (input.amount == null) {
			const error = new Error('amount is required');
			error.code = 'MISSING_AMOUNT';
			throw error;
		}
		return {
			status: 'needs_confirmation',
			preview: buildCreateExpensePreview(input),
			input,
		};
	}

	if (input.amount == null) {
		const error = new Error('amount is required');
		error.code = 'MISSING_AMOUNT';
		throw error;
	}

	const executor = createExpenseImpl || defaultCreateExpense;
	const result = await executor(clientId, input);

	return {
		status: 'created',
		expense: result,
		input,
	};
}
