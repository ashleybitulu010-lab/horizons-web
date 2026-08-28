import { getSupabaseAdmin } from '../supabase/client.js';
import { isSupabaseConfigured } from '../config/env.js';
import { requireClientScope } from './supabase-scoped.js';
import { resolveDateRange } from '../utils/periods.js';

export const DEPENSES_TABLE = 'depenses';
export const DEPENSES_SELECT = [
	'id',
	'client_id',
	'libelle_depense',
	'type_depense',
	'montant_depense',
	'date',
	'created_at',
].join(', ');

let queryExpensesImpl = null;

export function setExpensesQueryImplForTests(impl) {
	queryExpensesImpl = impl;
}

export function resetExpensesQueryImplForTests() {
	queryExpensesImpl = null;
}

function expenseAmount(row) {
	const amount = Number(row?.montant_depense);
	return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function expenseDate(row) {
	const raw = row?.date || row?.created_at;
	if (!raw) return null;
	const date = new Date(raw);
	return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeInput(input = {}) {
	return {
		period: input.period || null,
		startDate: input.startDate || null,
		endDate: input.endDate || null,
		category: input.category ? String(input.category).trim() : null,
		limit: Math.min(Math.max(Number(input.limit) || 500, 1), 1000),
		order: input.order === 'date_asc' ? 'date_asc' : 'date_desc',
	};
}

async function defaultQueryExpenses(clientId, range, input) {
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
		.from(DEPENSES_TABLE)
		.select(DEPENSES_SELECT)
		.eq('client_id', clientId)
		.gte('date', range.startIso)
		.lte('date', range.endIso);

	if (input.category) {
		query = query.ilike('libelle_depense', `%${input.category}%`);
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

export async function fetchExpensesForUser(user, rawInput = {}, referenceDate = new Date()) {
	const clientId = requireClientScope(user);
	const input = normalizeInput(rawInput);
	const range = resolveDateRange(input, referenceDate);

	const query = queryExpensesImpl || defaultQueryExpenses;
	const rows = await query(clientId, range, input);

	const filtered = rows.filter((row) => {
		const date = expenseDate(row);
		if (!date) return true;
		return date >= new Date(range.startIso) && date <= new Date(range.endIso);
	});

	return {
		rows: filtered,
		range,
		input,
	};
}

export function summarizeExpenses(rows) {
	const totalAmount = rows.reduce((sum, row) => sum + expenseAmount(row), 0);

	const byCategoryMap = new Map();
	for (const row of rows) {
		const key = String(row.type_depense || row.libelle_depense || 'Sans catégorie').trim() || 'Sans catégorie';
		const current = byCategoryMap.get(key) || {
			category: key,
			expenseCount: 0,
			totalAmount: 0,
		};
		current.expenseCount += 1;
		current.totalAmount += expenseAmount(row);
		byCategoryMap.set(key, current);
	}

	const byCategory = [...byCategoryMap.values()]
		.sort((a, b) => b.totalAmount - a.totalAmount)
		.map((entry) => ({
			...entry,
			totalAmount: Number(entry.totalAmount.toFixed(2)),
		}));

	return {
		count: rows.length,
		totalAmount: Number(totalAmount.toFixed(2)),
		byCategory,
	};
}

export async function getExpenses(user, rawInput = {}, referenceDate = new Date()) {
	const { rows, range, input } = await fetchExpensesForUser(user, rawInput, referenceDate);
	const summary = summarizeExpenses(rows);

	return {
		expenses: rows.map((row) => ({
			id: row.id,
			label: row.libelle_depense,
			category: row.type_depense,
			amount: expenseAmount(row),
			date: row.date || row.created_at || null,
		})),
		summary,
		range,
		input,
	};
}
