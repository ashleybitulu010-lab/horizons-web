import { getSupabaseAdmin } from '../supabase/client.js';
import { isSupabaseConfigured } from '../config/env.js';
import { requireClientScope } from './supabase-scoped.js';

export const PRODUITS_TABLE = 'produits';

export const PRODUITS_SELECT = [
	'id',
	'client_id',
	'nom_produit',
	'categorie',
	'prix_achat_unitaire',
	'prix_vente_unitaire',
	'created_at',
].join(', ');

export const PRODUCT_ORDERS = Object.freeze([
	'name_asc',
	'name_desc',
	'created_desc',
	'created_asc',
]);

let queryProductsImpl = null;

export function setProductsQueryImplForTests(impl) {
	queryProductsImpl = impl;
}

export function resetProductsQueryImplForTests() {
	queryProductsImpl = null;
}

function normalizeInput(input = {}) {
	return {
		product: input.product ? String(input.product).trim() : null,
		category: input.category ? String(input.category).trim() : null,
		limit: Math.min(Math.max(Number(input.limit) || 500, 1), 1000),
		order: PRODUCT_ORDERS.includes(input.order) ? input.order : 'name_asc',
	};
}

function mapProductRow(row) {
	return {
		id: row.id,
		name: String(row.nom_produit || '').trim() || 'Sans libellé',
		category: row.categorie ? String(row.categorie).trim() : null,
		purchasePrice: Number(row.prix_achat_unitaire) || 0,
		salePrice: Number(row.prix_vente_unitaire) || 0,
	};
}

export function summarizeProducts(productRows = []) {
	const products = productRows.map(mapProductRow);
	const categories = new Set(products.map((item) => item.category).filter(Boolean));

	return {
		count: products.length,
		categoryCount: categories.size,
		products,
	};
}

function applyOrder(query, order) {
	switch (order) {
	case 'name_desc':
		return query.order('nom_produit', { ascending: false });
	case 'created_desc':
		return query.order('created_at', { ascending: false });
	case 'created_asc':
		return query.order('created_at', { ascending: true });
	case 'name_asc':
	default:
		return query.order('nom_produit', { ascending: true });
	}
}

async function defaultQueryProducts(clientId, input) {
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
		.from(PRODUITS_TABLE)
		.select(PRODUITS_SELECT)
		.eq('client_id', clientId);

	if (input.product) {
		query = query.ilike('nom_produit', `%${input.product}%`);
	}

	if (input.category) {
		query = query.ilike('categorie', `%${input.category}%`);
	}

	query = applyOrder(query, input.order).limit(input.limit);

	const { data, error } = await query;
	if (error) {
		const wrapped = new Error(error.message);
		wrapped.code = 'SUPABASE_QUERY_FAILED';
		throw wrapped;
	}

	return data || [];
}

export async function fetchProductsForUser(user, rawInput = {}) {
	const clientId = requireClientScope(user);
	const input = normalizeInput(rawInput);
	const query = queryProductsImpl || defaultQueryProducts;
	const rows = await query(clientId, input);

	return {
		rows,
		input,
	};
}

export async function getProducts(user, rawInput = {}) {
	const { rows, input } = await fetchProductsForUser(user, rawInput);
	const summary = summarizeProducts(rows);

	return {
		products: summary.products,
		summary: {
			count: summary.count,
			categoryCount: summary.categoryCount,
		},
		input,
	};
}
