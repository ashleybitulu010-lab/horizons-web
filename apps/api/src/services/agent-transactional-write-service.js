import { getSupabaseAdmin } from '../supabase/client.js';
import { isSupabaseConfigured } from '../config/env.js';
import { getBusinessScope } from './supabase-scoped.js';
import { AgentSessionServiceError } from './agent-session-service.js';
import {
	refuseVenteStockMessage,
	stockAlertAfterSale,
} from './sales-write-service.js';
import { errorToolResult, successToolResult } from '../utils/tool-result.js';
import logger from '../utils/logger.js';

export const CONFIRM_AND_CREATE_EXPENSE_RPC = 'confirm_and_create_expense';
export const CONFIRM_AND_CREATE_SALE_RPC = 'confirm_and_create_sale';

export const TRANSACTIONAL_CONFIRM_STATUS = Object.freeze({
	COMMITTED: 'COMMITTED',
	ROLLED_BACK: 'ROLLED_BACK',
	ALREADY_CONSUMED: 'ALREADY_CONSUMED',
	VERSION_MISMATCH: 'VERSION_MISMATCH',
	ALREADY_COMPLETED: 'ALREADY_COMPLETED',
	REQUEST_HASH_MISMATCH: 'REQUEST_HASH_MISMATCH',
});

const transactionalMetrics = {
	transactional_write_success: 0,
	transactional_write_failure: 0,
	transactional_write_rollback: 0,
	transactional_write_conflict: 0,
};

let isTransactionalConfirmOverride = null;
let isIdempotentConfirmOverride = null;
let confirmAndCreateExpenseImpl = null;
let confirmAndCreateSaleImpl = null;

export function setIsTransactionalConfirmEnabledForTests(value) {
	isTransactionalConfirmOverride = value;
}

export function setIsIdempotentConfirmEnabledForTests(value) {
	isIdempotentConfirmOverride = value;
}

export function setConfirmAndCreateExpenseImplForTests(impl) {
	confirmAndCreateExpenseImpl = impl;
}

export function setConfirmAndCreateSaleImplForTests(impl) {
	confirmAndCreateSaleImpl = impl;
}

export function resetAgentTransactionalWriteForTests() {
	isTransactionalConfirmOverride = null;
	isIdempotentConfirmOverride = null;
	confirmAndCreateExpenseImpl = null;
	confirmAndCreateSaleImpl = null;
	transactionalMetrics.transactional_write_success = 0;
	transactionalMetrics.transactional_write_failure = 0;
	transactionalMetrics.transactional_write_rollback = 0;
	transactionalMetrics.transactional_write_conflict = 0;
}

export function getTransactionalWriteMetricsForTests() {
	return { ...transactionalMetrics };
}

export function isTransactionalConfirmEnabled() {
	if (isTransactionalConfirmOverride !== null) {
		return isTransactionalConfirmOverride;
	}
	return process.env.AGENT_SESSION_TRANSACTIONAL_CONFIRM === 'true';
}

export function isIdempotentConfirmEnabled() {
	if (isIdempotentConfirmOverride !== null) {
		return isIdempotentConfirmOverride;
	}
	return process.env.AGENT_SESSION_IDEMPOTENT_CONFIRM === 'true';
}

function assertSupabaseAvailable() {
	if (!isSupabaseConfigured()) {
		throw new AgentSessionServiceError('SUPABASE_UNAVAILABLE', 'Supabase is not configured');
	}
}

function sanitizeDbError(err, fallbackCode, fallbackMessage) {
	const message = String(err?.message || '');
	if (/service_role|supabase.*key|postgres|connection|password|secret/i.test(message)) {
		return new AgentSessionServiceError(fallbackCode, fallbackMessage);
	}
	return new AgentSessionServiceError(fallbackCode, fallbackMessage);
}

function mapExpenseRpcError(err) {
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
	const error = new Error(message || 'confirm_and_create_expense failed');
	error.code = 'SUPABASE_RPC_FAILED';
	return error;
}

function mapSaleRpcError(err) {
	const message = String(err?.message || err || '');
	if (/product not found|vente product not found/i.test(message)) {
		const error = new Error(message);
		error.code = 'PRODUCT_NOT_FOUND';
		return error;
	}
	if (/stock insuffisant|insufficient stock/i.test(message)) {
		const match = message.match(/\((\d+(?:\.\d+)?)\s+<\s+(\d+(?:\.\d+)?)\)/);
		const error = new Error(message);
		error.code = 'INSUFFICIENT_STOCK';
		if (match) {
			error.available = Number(match[1]);
			error.requested = Number(match[2]);
		}
		return error;
	}
	if (/quantity must be positive|unit_price must be positive|amount_paid required|product required/i.test(message)) {
		const error = new Error(message);
		error.code = 'INVALID_PARAMETER';
		return error;
	}
	const error = new Error(message || 'confirm_and_create_sale failed');
	error.code = 'SUPABASE_RPC_FAILED';
	return error;
}

async function defaultConfirmAndCreateExpense(
	scope,
	{ expectedVersion = null, consumeToken = null, operationId = null, requestHash = null } = {},
) {
	assertSupabaseAvailable();
	const admin = getSupabaseAdmin();
	if (!admin) {
		throw new AgentSessionServiceError('SUPABASE_UNAVAILABLE', 'Supabase client is unavailable');
	}

	const { data, error } = await admin.rpc(CONFIRM_AND_CREATE_EXPENSE_RPC, {
		p_client_id: scope.clientId,
		p_activity_id: scope.activityId,
		p_expected_version: expectedVersion,
		p_consume_token: consumeToken,
		p_operation_id: operationId,
		p_request_hash: requestHash,
	});

	if (error) {
		throw mapExpenseRpcError(error);
	}

	return data ?? { success: false, status: 'ROLLED_BACK', pending_consumed: false };
}

async function defaultConfirmAndCreateSale(
	scope,
	{ expectedVersion = null, consumeToken = null, operationId = null, requestHash = null } = {},
) {
	assertSupabaseAvailable();
	const admin = getSupabaseAdmin();
	if (!admin) {
		throw new AgentSessionServiceError('SUPABASE_UNAVAILABLE', 'Supabase client is unavailable');
	}

	const { data, error } = await admin.rpc(CONFIRM_AND_CREATE_SALE_RPC, {
		p_client_id: scope.clientId,
		p_activity_id: scope.activityId,
		p_expected_version: expectedVersion,
		p_consume_token: consumeToken,
		p_operation_id: operationId,
		p_request_hash: requestHash,
	});

	if (error) {
		throw mapSaleRpcError(error);
	}

	return data ?? { success: false, status: 'ROLLED_BACK', pending_consumed: false };
}

function recordTransactionalOutcome(result) {
	if (result?.success && (
		result?.status === TRANSACTIONAL_CONFIRM_STATUS.COMMITTED
		|| result?.status === TRANSACTIONAL_CONFIRM_STATUS.ALREADY_COMPLETED
	)) {
		transactionalMetrics.transactional_write_success += 1;
		return;
	}
	if (result?.status === TRANSACTIONAL_CONFIRM_STATUS.ALREADY_CONSUMED
		|| result?.status === TRANSACTIONAL_CONFIRM_STATUS.VERSION_MISMATCH
		|| result?.status === TRANSACTIONAL_CONFIRM_STATUS.REQUEST_HASH_MISMATCH) {
		transactionalMetrics.transactional_write_conflict += 1;
		return;
	}
	transactionalMetrics.transactional_write_failure += 1;
}

export async function confirmAndCreateExpense({
	user,
	expectedVersion = null,
	consumeToken = null,
	operationId = null,
	requestHash = null,
}) {
	const scope = getBusinessScope(user);
	if (expectedVersion == null && !consumeToken) {
		throw new AgentSessionServiceError(
			'CONSUME_TOKEN_REQUIRED',
			'expectedVersion or consumeToken is required',
		);
	}

	const executor = confirmAndCreateExpenseImpl || defaultConfirmAndCreateExpense;
	try {
		const result = await executor(scope, {
			expectedVersion,
			consumeToken,
			operationId,
			requestHash,
		});
		recordTransactionalOutcome(result);
		logger.info('transactional_write_expense', {
			status: result?.status,
			success: Boolean(result?.success),
			pendingConsumed: Boolean(result?.pending_consumed),
		});
		return result;
	} catch (err) {
		transactionalMetrics.transactional_write_rollback += 1;
		logger.info('transactional_write_expense', {
			status: TRANSACTIONAL_CONFIRM_STATUS.ROLLED_BACK,
			success: false,
			pendingConsumed: false,
		});
		throw err;
	}
}

export async function confirmAndCreateSale({
	user,
	expectedVersion = null,
	consumeToken = null,
	operationId = null,
	requestHash = null,
}) {
	const scope = getBusinessScope(user);
	if (expectedVersion == null && !consumeToken) {
		throw new AgentSessionServiceError(
			'CONSUME_TOKEN_REQUIRED',
			'expectedVersion or consumeToken is required',
		);
	}

	const executor = confirmAndCreateSaleImpl || defaultConfirmAndCreateSale;
	try {
		const result = await executor(scope, {
			expectedVersion,
			consumeToken,
			operationId,
			requestHash,
		});
		recordTransactionalOutcome(result);
		logger.info('transactional_write_sale', {
			status: result?.status,
			success: Boolean(result?.success),
			pendingConsumed: Boolean(result?.pending_consumed),
		});
		return result;
	} catch (err) {
		transactionalMetrics.transactional_write_rollback += 1;
		logger.info('transactional_write_sale', {
			status: TRANSACTIONAL_CONFIRM_STATUS.ROLLED_BACK,
			success: false,
			pendingConsumed: false,
		});
		throw err;
	}
}

export function buildExpenseToolResultFromTransactional(data) {
	return successToolResult('create_expense', {
		summary: {
			expenseId: data.result_id,
			label: data.label,
			amount: Number(data.amount),
		},
	}, {
		label: data.label,
		amount: Number(data.amount),
	});
}

export function buildSaleToolResultFromTransactional(data, pendingWrite = {}) {
	const stockRemaining = Number(data.stockRemaining) || 0;
	const stockThreshold = Number(data.stockThreshold) || 5;
	const product = data.product || pendingWrite.product;
	const quantity = Number(data.quantity) || pendingWrite.quantity;
	const stockAlert = stockAlertAfterSale(product, stockRemaining, stockThreshold);

	return successToolResult('create_sale', {
		summary: {
			saleId: data.result_id,
			product,
			quantity,
			unitPrice: Number(data.unitPrice),
			amountPaid: Number(data.amountPaid),
			total: Number(data.total),
			stockRemaining,
			stockAlert: stockAlert || null,
		},
	}, {
		product,
		quantity,
		stockRemaining,
	});
}

export function buildTransactionalToolError(tool, err, pendingWrite = {}) {
	if (err?.code === 'MISSING_LABEL' || err?.code === 'INVALID_PARAMETER') {
		return errorToolResult(tool, err.code, err.message);
	}
	if (err?.code === 'PRODUCT_NOT_FOUND') {
		return errorToolResult(tool, 'PRODUCT_NOT_FOUND', 'Product not found in catalogue');
	}
	if (err?.code === 'INSUFFICIENT_STOCK') {
		const message = err.available != null
			? refuseVenteStockMessage(pendingWrite.product, err.available, err.requested ?? pendingWrite.quantity)
			: err.message;
		return errorToolResult(tool, 'INSUFFICIENT_STOCK', message);
	}
	return errorToolResult(tool, 'INTERNAL_ERROR', `Unable to complete the ${tool === 'create_sale' ? 'sale' : 'expense'} request`);
}
