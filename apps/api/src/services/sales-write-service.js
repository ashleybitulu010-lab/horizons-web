import { getSupabaseAdmin } from '../supabase/client.js';
import { isSupabaseConfigured } from '../config/env.js';
import { requireClientScope } from './supabase-scoped.js';
import { PRODUITS_TABLE, PRODUITS_SELECT } from './products-service.js';
import { STOCKS_SELECT, DEFAULT_STOCK_THRESHOLD } from './stock-service.js';

export const CREATE_SALE_RPC = 'create_sale_atomic';

const DEFAULT_SEUIL = DEFAULT_STOCK_THRESHOLD;

let createSaleImpl = null;

export function setCreateSaleImplForTests(impl) {
	createSaleImpl = impl;
}

export function resetCreateSaleImplForTests() {
	createSaleImpl = null;
}

function parsePositiveNumber(value, fieldName) {
	const num = Number(value);
	if (!Number.isFinite(num) || num <= 0) {
		const error = new Error(`${fieldName} must be a positive number`);
		error.code = 'INVALID_PARAMETER';
		throw error;
	}
	return num;
}

function parseAmountPaid(value) {
	if (value === null || value === undefined || value === '') {
		const error = new Error('amountPaid is required');
		error.code = 'MISSING_AMOUNT_PAID';
		throw error;
	}
	const num = Number(value);
	if (!Number.isFinite(num) || num < 0) {
		const error = new Error('amountPaid must be a non-negative number');
		error.code = 'INVALID_PARAMETER';
		throw error;
	}
	return num;
}

export function normalizeCreateSaleInput(raw = {}) {
	const product = String(raw.product || raw.produit || '').trim();
	if (!product) {
		const error = new Error('product is required');
		error.code = 'MISSING_PRODUCT';
		throw error;
	}

	return {
		product,
		quantity: parsePositiveNumber(raw.quantity ?? raw.quantite, 'quantity'),
		unitPrice: raw.unitPrice != null || raw.prix_unitaire != null || raw.unit_price != null
			? parsePositiveNumber(raw.unitPrice ?? raw.prix_unitaire ?? raw.unit_price, 'unitPrice')
			: null,
		amountPaid: raw.amountPaid !== undefined || raw.montant_paye !== undefined
			? parseAmountPaid(raw.amountPaid ?? raw.montant_paye)
			: null,
		confirmed: Boolean(raw.confirmed),
	};
}

export function refuseVenteStockMessage(product, available, quantity) {
	const name = product || 'ce produit';
	const q = Number(quantity) || 0;
	const d = Number(available) || 0;
	if (d <= 0) {
		return `❌ Tu n'as plus de ${name} en stock. Je ne peux pas enregistrer cette vente. Ajoute d'abord une entrée de stock.`;
	}
	return `⚠️ Il ne reste que ${d} ${name} en stock. Je ne peux pas enregistrer une vente de ${q} ${name}. Il faut d'abord réapprovisionner le stock.`;
}

export function stockAlertAfterSale(product, remaining, threshold = DEFAULT_SEUIL) {
	const name = product || 'ce produit';
	const r = Number(remaining) || 0;
	const s = Number(threshold) > 0 ? Number(threshold) : DEFAULT_SEUIL;
	if (r <= 0) {
		return `⚠️ Ton stock de ${name} est maintenant à 0. Le produit est épuisé, pense à le réapprovisionner.`;
	}
	if (r < s) {
		return `⚠️ Ton stock est très faible (${r} ${name} restant${r > 1 ? 's' : ''}), pense à te réapprovisionner.`;
	}
	return '';
}

function mapRpcError(err) {
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

	const error = new Error(message || 'create_sale_atomic failed');
	error.code = 'SUPABASE_RPC_FAILED';
	return error;
}

async function resolveUnitPriceFromCatalog(clientId, product, unitPrice) {
	if (unitPrice != null && unitPrice > 0) {
		return unitPrice;
	}

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

	const needle = product.toLowerCase();
	const { data, error } = await admin
		.from(PRODUITS_TABLE)
		.select(PRODUITS_SELECT)
		.eq('client_id', clientId)
		.ilike('nom_produit', `%${needle}%`)
		.order('created_at', { ascending: false })
		.limit(5);

	if (error) {
		const wrapped = new Error(error.message);
		wrapped.code = 'SUPABASE_QUERY_FAILED';
		throw wrapped;
	}

	const rows = data || [];
	const exact = rows.find((row) => String(row.nom_produit || '').trim().toLowerCase() === needle);
	const match = exact || rows[0];
	const catalogPrice = Number(match?.prix_vente_unitaire) || 0;

	if (catalogPrice > 0) {
		return catalogPrice;
	}

	const missing = new Error('unitPrice is required when catalogue price is unavailable');
	missing.code = 'MISSING_UNIT_PRICE';
	throw missing;
}

async function defaultCreateSale(clientId, input) {
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

	const unitPrice = await resolveUnitPriceFromCatalog(clientId, input.product, input.unitPrice);
	const amountPaid = parseAmountPaid(input.amountPaid);

	const { data, error } = await admin.rpc(CREATE_SALE_RPC, {
		p_client_id: clientId,
		p_product: input.product,
		p_quantity: input.quantity,
		p_unit_price: unitPrice,
		p_amount_paid: amountPaid,
	});

	if (error) {
		throw mapRpcError(error);
	}

	if (!data?.ok) {
		const failure = new Error('create_sale_atomic returned unsuccessful result');
		failure.code = 'SUPABASE_RPC_FAILED';
		throw failure;
	}

	const stockRemaining = Number(data.stockRemaining) || 0;
	const stockThreshold = Number(data.stockThreshold) || DEFAULT_SEUIL;
	const stockAlert = stockAlertAfterSale(input.product, stockRemaining, stockThreshold);

	return {
		saleId: data.saleId,
		product: data.product || input.product,
		productId: data.productId || null,
		quantity: Number(data.quantity) || input.quantity,
		unitPrice: Number(data.unitPrice) || unitPrice,
		amountPaid: Number(data.amountPaid) ?? amountPaid,
		total: Number(data.total) || (input.quantity * unitPrice),
		stockRemaining,
		stockThreshold,
		stockAlert,
		stockNumero: data.stockNumero ?? null,
	};
}

export function buildCreateSalePreview(input) {
	const unitPrice = input.unitPrice;
	const total = unitPrice != null ? Number((input.quantity * unitPrice).toFixed(2)) : null;
	return {
		product: input.product,
		quantity: input.quantity,
		unitPrice,
		amountPaid: input.amountPaid,
		total,
	};
}

export async function createSaleForUser(user, rawInput = {}) {
	const clientId = requireClientScope(user);
	const input = normalizeCreateSaleInput(rawInput);

	if (!input.confirmed) {
		let unitPrice = input.unitPrice;
		if (unitPrice == null) {
			try {
				unitPrice = await resolveUnitPriceFromCatalog(clientId, input.product, null);
			} catch {
				unitPrice = null;
			}
		}
		const preview = buildCreateSalePreview({ ...input, unitPrice });
		return {
			status: 'needs_confirmation',
			preview,
			input: { ...input, unitPrice },
		};
	}

	if (input.unitPrice == null) {
		input.unitPrice = await resolveUnitPriceFromCatalog(clientId, input.product, null);
	}

	if (input.amountPaid == null) {
		const error = new Error('amountPaid is required');
		error.code = 'MISSING_AMOUNT_PAID';
		throw error;
	}

	const executor = createSaleImpl || defaultCreateSale;
	const result = await executor(clientId, input);

	return {
		status: 'created',
		sale: result,
		input,
	};
}
