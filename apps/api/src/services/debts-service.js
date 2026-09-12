import { getSupabaseAdmin } from '../supabase/client.js';
import { isSupabaseConfigured } from '../config/env.js';
import { getBusinessScope } from './supabase-scoped.js';
import { resolveDateRange } from '../utils/periods.js';

export const VENTES_TABLE = 'ventes';
export const DEBTS_VENTES_SELECT = [
	'id',
	'client_id',
	'libelle',
	'quantite',
	'prix_unitaire',
	'montant_paye',
	'total_brut',
	'reste_a_payer',
	'date',
	'statut',
	'produit_id',
	'created_at',
].join(', ');

export const DEBT_STATUS = Object.freeze(['unpaid', 'settled', 'all']);

let queryDebtsImpl = null;

export function setDebtsQueryImplForTests(impl) {
	queryDebtsImpl = impl;
}

export function resetDebtsQueryImplForTests() {
	queryDebtsImpl = null;
}

function isCancelledSale(row) {
	return /annul/i.test(String(row?.statut || ''));
}

function saleDate(row) {
	const raw = row?.date || row?.created_at;
	if (!raw) return null;
	const date = new Date(raw);
	return Number.isNaN(date.getTime()) ? null : date;
}

function remainingAmount(row) {
	const remaining = Number(row?.reste_a_payer);
	return Number.isFinite(remaining) && remaining > 0 ? remaining : 0;
}

function paidAmount(row) {
	const paid = Number(row?.montant_paye);
	return Number.isFinite(paid) && paid >= 0 ? paid : 0;
}

function normalizeInput(input = {}) {
	const status = DEBT_STATUS.includes(input.status) ? input.status : 'unpaid';
	return {
		period: input.period || null,
		startDate: input.startDate || null,
		endDate: input.endDate || null,
		status,
		debtor: input.debtor ? String(input.debtor).trim() : null,
		limit: Math.min(Math.max(Number(input.limit) || 500, 1), 1000),
		order: input.order === 'date_asc' ? 'date_asc' : 'date_desc',
	};
}

function resolveOptionalRange(input, referenceDate) {
	if (input.period || (input.startDate && input.endDate)) {
		return resolveDateRange(input, referenceDate);
	}
	return null;
}

async function defaultQueryDebts(scope, range, input) {
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

	let query = admin
		.from(VENTES_TABLE)
		.select(DEBTS_VENTES_SELECT)
		.eq('client_id', scope.clientId)
		.eq('activity_id', scope.activityId);

	if (range) {
		query = query.gte('date', range.startIso).lte('date', range.endIso);
	}

	if (input.status === 'unpaid') {
		query = query.gt('reste_a_payer', 0);
	} else if (input.status === 'settled') {
		query = query.eq('reste_a_payer', 0).gt('montant_paye', 0);
	}

	query = query.order('date', { ascending: input.order === 'date_asc' }).limit(input.limit);

	const { data, error } = await query;
	if (error) {
		const wrapped = new Error(error.message);
		wrapped.code = 'SUPABASE_QUERY_FAILED';
		throw wrapped;
	}

	return data || [];
}

function matchesDebtor(row, debtor) {
	if (!debtor) return true;
	const needle = debtor.toLowerCase();
	const label = String(row?.libelle || '').toLowerCase();
	const status = String(row?.statut || '').toLowerCase();
	return label.includes(needle) || status.includes(needle);
}

export async function fetchDebtsForUser(user, rawInput = {}, referenceDate = new Date()) {
	const scope = getBusinessScope(user);
	const input = normalizeInput(rawInput);
	const range = resolveOptionalRange(input, referenceDate);

	const query = queryDebtsImpl || defaultQueryDebts;
	const rows = await query(scope, range, input);

	const filtered = rows
		.filter((row) => !isCancelledSale(row))
		.filter((row) => matchesDebtor(row, input.debtor))
		.filter((row) => {
			if (!range) return true;
			const date = saleDate(row);
			if (!date) return true;
			return date >= new Date(range.startIso) && date <= new Date(range.endIso);
		})
		.filter((row) => {
			if (input.status === 'unpaid') return remainingAmount(row) > 0;
			if (input.status === 'settled') return remainingAmount(row) === 0 && paidAmount(row) > 0;
			return true;
		});

	return {
		rows: filtered,
		range,
		input,
	};
}

export function summarizeDebts(rows, status = 'unpaid') {
	const unpaidRows = rows.filter((row) => remainingAmount(row) > 0);
	const totalRemaining = unpaidRows.reduce((sum, row) => sum + remainingAmount(row), 0);

	const byDebtorMap = new Map();
	for (const row of rows) {
		const remaining = remainingAmount(row);
		if (status === 'unpaid' && remaining <= 0) continue;

		const key = String(row.libelle || row.id).trim() || 'Sans libellé';
		const current = byDebtorMap.get(key) || {
			label: key,
			debtCount: 0,
			totalRemaining: 0,
		};
		current.debtCount += 1;
		current.totalRemaining += remaining;
		byDebtorMap.set(key, current);
	}

	const byDebtor = [...byDebtorMap.values()]
		.sort((a, b) => b.totalRemaining - a.totalRemaining)
		.map((entry) => ({
			...entry,
			totalRemaining: Number(entry.totalRemaining.toFixed(2)),
		}));

	const debtorKeys = new Set(byDebtor.map((entry) => entry.label));

	return {
		count: rows.length,
		unpaidCount: unpaidRows.length,
		totalRemaining: Number(totalRemaining.toFixed(2)),
		debtorCount: debtorKeys.size,
		byDebtor,
	};
}

export async function getDebts(user, rawInput = {}, referenceDate = new Date()) {
	const { rows, range, input } = await fetchDebtsForUser(user, rawInput, referenceDate);
	const summary = summarizeDebts(rows, input.status);

	return {
		debts: rows.map((row) => ({
			id: row.id,
			label: row.libelle,
			remaining: remainingAmount(row),
			paid: paidAmount(row),
			total: Number(row.total_brut) || paidAmount(row) + remainingAmount(row),
			status: row.statut,
			date: row.date || row.created_at || null,
		})),
		summary,
		range,
		input,
	};
}
