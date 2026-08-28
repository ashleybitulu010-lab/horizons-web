import { getSupabaseAdmin } from '../supabase/client.js';
import { isSupabaseConfigured } from '../config/env.js';
import { requireClientScope } from './supabase-scoped.js';

export const STOCKS_TABLE = 'stocks';
export const PRODUITS_TABLE = 'produits';
export const DEFAULT_STOCK_THRESHOLD = 5;

export const STOCKS_SELECT = [
	'numero',
	'client_id',
	'produit_id',
	'nom_article',
	'stock_initial',
	'entrees',
	'sorties',
	'stock_actuel',
	'seuil_alerte',
	'created_at',
].join(', ');

export const PRODUITS_SELECT = [
	'id',
	'client_id',
	'nom_produit',
	'categorie',
].join(', ');

let queryStockImpl = null;

export function setStockQueryImplForTests(impl) {
	queryStockImpl = impl;
}

export function resetStockQueryImplForTests() {
	queryStockImpl = null;
}

function normalizeInput(input = {}) {
	return {
		product: input.product ? String(input.product).trim() : null,
		lowStockOnly: Boolean(input.lowStockOnly),
		limit: Math.min(Math.max(Number(input.limit) || 500, 1), 1000),
	};
}

function stockQuantity(row) {
	const current = Number(row?.stock_actuel);
	if (Number.isFinite(current)) {
		return Math.max(0, current);
	}

	const initial = Number(row?.stock_initial) || 0;
	const entries = Number(row?.entrees) || 0;
	const exits = Number(row?.sorties) || 0;
	return Math.max(0, initial + entries - exits);
}

function effectiveThreshold(row) {
	const configured = Number(row?.seuil_alerte);
	if (Number.isFinite(configured) && configured > 0) {
		return configured;
	}
	return DEFAULT_STOCK_THRESHOLD;
}

async function defaultQueryStock(clientId, input) {
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

	let stockQuery = admin
		.from(STOCKS_TABLE)
		.select(STOCKS_SELECT)
		.eq('client_id', clientId);

	if (input.product) {
		stockQuery = stockQuery.ilike('nom_article', `%${input.product}%`);
	}

	stockQuery = stockQuery.order('created_at', { ascending: false }).limit(input.limit);

	const [{ data: stockRows, error: stockError }, { data: productRows, error: productError }] = await Promise.all([
		stockQuery,
		admin.from(PRODUITS_TABLE).select(PRODUITS_SELECT).eq('client_id', clientId).limit(input.limit),
	]);

	if (stockError) {
		const wrapped = new Error(stockError.message);
		wrapped.code = 'SUPABASE_QUERY_FAILED';
		throw wrapped;
	}
	if (productError) {
		const wrapped = new Error(productError.message);
		wrapped.code = 'SUPABASE_QUERY_FAILED';
		throw wrapped;
	}

	return {
		stocks: stockRows || [],
		products: productRows || [],
	};
}

function resolveProductName(stockRow, productById) {
	const linked = stockRow?.produit_id ? productById.get(stockRow.produit_id) : null;
	return String(
		linked?.nom_produit
		|| stockRow?.nom_article
		|| 'Sans libellé',
	).trim() || 'Sans libellé';
}

export function summarizeStock(stockRows, productRows = [], input = {}) {
	const productById = new Map((productRows || []).map((row) => [row.id, row]));
	const grouped = new Map();

	for (const row of stockRows) {
		const key = row.produit_id || row.nom_article || row.numero;
		const current = grouped.get(key) || {
			productId: row.produit_id || null,
			name: resolveProductName(row, productById),
			category: productById.get(row.produit_id)?.categorie || null,
			quantity: 0,
			threshold: effectiveThreshold(row),
		};
		current.quantity += stockQuantity(row);
		current.threshold = Math.max(current.threshold, effectiveThreshold(row));
		grouped.set(key, current);
	}

	let items = [...grouped.values()].map((item) => ({
		...item,
		quantity: Number(item.quantity.toFixed(2)),
		isLow: item.quantity <= item.threshold,
		isOutOfStock: item.quantity <= 0,
	}));

	if (input.product) {
		const needle = input.product.toLowerCase();
		items = items.filter((item) => item.name.toLowerCase().includes(needle));
	}

	if (input.lowStockOnly) {
		items = items.filter((item) => item.isLow);
	}

	items.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

	const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

	return {
		count: items.length,
		totalQuantity: Number(totalQuantity.toFixed(2)),
		lowStockCount: items.filter((item) => item.isLow).length,
		outOfStockCount: items.filter((item) => item.isOutOfStock).length,
		items,
	};
}

export async function fetchStockForUser(user, rawInput = {}) {
	const clientId = requireClientScope(user);
	const input = normalizeInput(rawInput);
	const query = queryStockImpl || defaultQueryStock;
	const { stocks, products } = await query(clientId, input);

	return {
		rows: stocks,
		products,
		input,
	};
}

export async function getStock(user, rawInput = {}) {
	const { rows, products, input } = await fetchStockForUser(user, rawInput);
	const summary = summarizeStock(rows, products, input);

	return {
		items: summary.items,
		summary,
		input,
	};
}
