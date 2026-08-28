import { getSupabaseAdmin } from '../supabase/client.js';
import { isSupabaseConfigured } from '../config/env.js';
import { requireClientScope } from './supabase-scoped.js';
import { resolveDateRange } from '../utils/periods.js';

export const VENTES_TABLE = 'ventes';
export const VENTES_SELECT = [
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

let querySalesImpl = null;

export function setSalesQueryImplForTests(impl) {
	querySalesImpl = impl;
}

export function resetSalesQueryImplForTests() {
	querySalesImpl = null;
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

function saleRevenue(row) {
	const totalBrut = Number(row?.total_brut);
	if (Number.isFinite(totalBrut) && totalBrut >= 0) return totalBrut;

	const paid = Math.max(0, Number(row?.montant_paye) || 0);
	const remaining = Math.max(0, Number(row?.reste_a_payer) || 0);
	if (paid > 0 || remaining > 0) return paid + remaining;

	const qty = Math.max(0, Number(row?.quantite) || 0);
	const unit = Math.max(0, Number(row?.prix_unitaire) || 0);
	return qty * unit;
}

function normalizeInput(input = {}) {
	return {
		period: input.period || null,
		startDate: input.startDate || null,
		endDate: input.endDate || null,
		product: input.product ? String(input.product).trim() : null,
		limit: Math.min(Math.max(Number(input.limit) || 500, 1), 1000),
		order: input.order === 'date_asc' ? 'date_asc' : 'date_desc',
		includeCancelled: Boolean(input.includeCancelled),
	};
}

async function defaultQuerySales(clientId, range, input) {
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
		.select(VENTES_SELECT)
		.eq('client_id', clientId)
		.gte('date', range.startIso)
		.lte('date', range.endIso);

	if (input.product) {
		query = query.ilike('libelle', `%${input.product}%`);
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

export async function fetchSalesForUser(user, rawInput = {}, referenceDate = new Date()) {
	const clientId = requireClientScope(user);
	const input = normalizeInput(rawInput);
	const range = resolveDateRange(input, referenceDate);

	const query = querySalesImpl || defaultQuerySales;
	const rows = await query(clientId, range, input);

	const filtered = rows.filter((row) => {
		if (!input.includeCancelled && isCancelledSale(row)) return false;
		const date = saleDate(row);
		if (!date) return true;
		return date >= new Date(range.startIso) && date <= new Date(range.endIso);
	});

	return {
		rows: filtered,
		range,
		input,
	};
}

export function summarizeSales(rows) {
	const activeRows = rows.filter((row) => !isCancelledSale(row));
	const totalRevenue = activeRows.reduce((sum, row) => sum + saleRevenue(row), 0);
	const totalCollected = activeRows.reduce((sum, row) => sum + Math.max(0, Number(row.montant_paye) || 0), 0);
	const totalOutstanding = activeRows.reduce((sum, row) => sum + Math.max(0, Number(row.reste_a_payer) || 0), 0);
	const totalQuantity = activeRows.reduce((sum, row) => sum + Math.max(0, Number(row.quantite) || 0), 0);

	const byProductMap = new Map();
	for (const row of activeRows) {
		const key = String(row.libelle || 'Sans libellé').trim() || 'Sans libellé';
		const current = byProductMap.get(key) || {
			product: key,
			saleCount: 0,
			quantity: 0,
			revenue: 0,
		};
		current.saleCount += 1;
		current.quantity += Math.max(0, Number(row.quantite) || 0);
		current.revenue += saleRevenue(row);
		byProductMap.set(key, current);
	}

	const byProduct = [...byProductMap.values()].sort((a, b) => b.revenue - a.revenue);

	return {
		count: activeRows.length,
		totalRevenue: Number(totalRevenue.toFixed(2)),
		totalCollected: Number(totalCollected.toFixed(2)),
		totalOutstanding: Number(totalOutstanding.toFixed(2)),
		totalQuantity: Number(totalQuantity.toFixed(2)),
		byProduct,
	};
}

export async function getSales(user, rawInput = {}, referenceDate = new Date()) {
	const { rows, range, input } = await fetchSalesForUser(user, rawInput, referenceDate);
	const summary = summarizeSales(rows);

	return {
		sales: rows,
		summary,
		range,
		input,
	};
}
