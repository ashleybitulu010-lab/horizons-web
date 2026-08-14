import { cleanUtf8Text } from '@/lib/textEncoding';

const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_FIELDS = {
  ventes: ['date_vente', 'sold_at', 'date', 'created_at', 'created'],
  depenses: ['date_depense', 'spent_at', 'date', 'created_at', 'created'],
  produits: ['created_at', 'created', 'date_creation', 'date'],
  stocks: ['date_stock', 'date_mouvement', 'created_at', 'created', 'date'],
  paiements_dettes: ['paid_at', 'date_paiement', 'created_at', 'created', 'date'],
};

const PRODUCT_NAME_FIELDS = [
  'nom_produit',
  'nom_article',
  'nom',
  'name',
  'libelle',
  'designation',
  'produit_vendu',
];
const PRODUCT_CATEGORY_FIELDS = ['categorie', 'category', 'nom_categorie', 'type'];
const PRODUCT_PURCHASE_PRICE_FIELDS = [
  'prix_achat_unitaire',
  'prix_achat',
  'cout_achat',
  'purchase_price',
  'cost_price',
  'cout_unitaire',
];
const PRODUCT_SALE_PRICE_FIELDS = [
  'prix_vente_unitaire',
  'prix_vente',
  'sale_price',
  'selling_price',
  'prix_unitaire',
];
const STOCK_INITIAL_FIELDS = ['stock_initial', 'initial_stock', 'quantite_initiale'];
const STOCK_ENTRY_FIELDS = [
  'entrees',
  'quantite_ajoutee',
  'quantite_entree',
  'entries',
];
const STOCK_EXIT_FIELDS = [
  'sorties',
  'quantite_sortie',
  'quantite_retiree',
  'exits',
];
const STOCK_FALLBACK_QUANTITY_FIELDS = [
  'quantite',
  'quantity',
  'mouvement',
];
const SALE_QUANTITY_FIELDS = ['quantite', 'quantity', 'quantite_vendue', 'qte', 'units'];
/** Fields for realized revenue (CA) — never use montant_paye alone here. */
const SALE_REVENUE_FIELDS = [
  'total_brut',
  'montant_total',
  'total_vente',
  'total',
  'chiffre_affaires',
  'amount',
];
const SALE_UNIT_PRICE_FIELDS = ['prix_unitaire', 'prix_vente', 'unit_price', 'sale_price'];
const EXPENSE_AMOUNT_FIELDS = ['montant_depense', 'montant', 'montant_total', 'total', 'amount', 'valeur'];
const PAYMENT_AMOUNT_FIELDS = ['montant', 'montant_paye', 'amount', 'payment_amount'];
const EXPENSE_NAME_FIELDS = [
  'libelle_depense',
  'type_depense',
  'libelle',
  'description',
  'motif',
  'nom_depense',
  'categorie',
  'category',
  'type',
];
const PRODUCT_ID_FIELDS = ['produit_id', 'product_id', 'id_produit'];

function firstValue(row, fields) {
  if (!row) return null;
  for (const field of fields) {
    const value = row[field];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;

  let normalized = value.trim().replace(/\s/g, '').replace(/[^\d,.-]/g, '');
  if (normalized.includes(',') && !normalized.includes('.')) {
    normalized = normalized.replace(',', '.');
  } else {
    normalized = normalized.replace(/,/g, '');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(row, fields) {
  for (const field of fields) {
    const value = toNumber(row?.[field]);
    if (value !== null) return value;
  }
  return null;
}

function rowId(row) {
  return String(row?.id ?? row?.uuid ?? row?.numero ?? '');
}

function relatedProductId(row) {
  const value = firstValue(row, PRODUCT_ID_FIELDS);
  if (value && typeof value === 'object') return String(value.id ?? value.uuid ?? '');
  return value === null || value === undefined ? '' : String(value);
}

function normalizeLabel(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/s$/i, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Resolve product by FK first, then by name match (nom_article / libelle). */
function resolveProduct(row, productById, products = []) {
  const byId = productById.get(relatedProductId(row));
  if (byId) return byId;

  const label = normalizeLabel(firstValue(row, PRODUCT_NAME_FIELDS));
  if (!label || !products.length) return null;

  const exact = products.find((product) => normalizeLabel(productName(product)) === label);
  if (exact) return exact;

  return products.find((product) => {
    const name = normalizeLabel(productName(product));
    return name && (label.includes(name) || name.includes(label));
  }) || null;
}

function saleUnitPrice(sale, product) {
  const fromSale = firstNumber(sale, SALE_UNIT_PRICE_FIELDS);
  if (fromSale !== null && fromSale > 0) return fromSale;
  return Math.max(0, firstNumber(product, PRODUCT_SALE_PRICE_FIELDS) ?? 0);
}

function normalizeDateInput(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === 'number') {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = String(raw).trim();
  if (!text) return null;
  // Safari rejects "YYYY-MM-DD HH:mm:ss" — normalize to ISO-like form.
  const spaced = text.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
  const candidates = [text, spaced, spaced.endsWith('Z') ? spaced : `${spaced}Z`];
  for (const candidate of candidates) {
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function parseDate(row, type) {
  const raw = firstValue(row, DATE_FIELDS[type] || []);
  return normalizeDateInput(raw);
}

function productName(product) {
  return cleanUtf8Text(firstValue(product, PRODUCT_NAME_FIELDS) || 'Produit sans nom');
}

function productCategory(product) {
  return cleanUtf8Text(firstValue(product, PRODUCT_CATEGORY_FIELDS) || 'Non catégorisé');
}

function saleProductName(sale, product) {
  return cleanUtf8Text(product ? productName(product) : firstValue(sale, PRODUCT_NAME_FIELDS) || 'Produit');
}

function saleCategory(sale, product) {
  return cleanUtf8Text(product ? productCategory(product) : firstValue(sale, PRODUCT_CATEGORY_FIELDS) || 'Non catégorisé');
}

function saleQuantity(sale) {
  return Math.max(0, firstNumber(sale, SALE_QUANTITY_FIELDS) ?? 0);
}

/** Cash actually collected on a sale (encaissements). */
function saleCollectedAmount(sale) {
  return Math.max(0, firstNumber(sale, ['montant_paye']) ?? 0);
}

/**
 * Realized revenue (chiffre d'affaires) = encashed + credit/outstanding.
 * Prefer total_brut; else montant_paye + reste_a_payer; else qty × unit price.
 */
function saleRevenueAmount(sale, product) {
  const brut = firstNumber(sale, SALE_REVENUE_FIELDS);
  if (brut !== null) return Math.max(0, brut);

  const paid = saleCollectedAmount(sale);
  const remaining = Math.max(0, firstNumber(sale, ['reste_a_payer', 'montant_restant', 'remaining']) ?? 0);
  if (paid > 0 || remaining > 0) return paid + remaining;

  return Math.max(0, saleQuantity(sale) * saleUnitPrice(sale, product));
}

/** Realized sale value for activity / top-product displays. */
function saleAmount(sale, product) {
  return saleRevenueAmount(sale, product);
}

function expenseAmount(expense) {
  return Math.max(0, firstNumber(expense, EXPENSE_AMOUNT_FIELDS) ?? 0);
}

function paymentAmount(payment) {
  return Math.max(0, firstNumber(payment, PAYMENT_AMOUNT_FIELDS) ?? 0);
}

function buildDebtMetrics(ventes, payments = []) {
  const debtSales = ventes
    .map((sale) => ({
      sale,
      total: saleRevenueAmount(sale),
      remaining: Math.max(0, firstNumber(sale, ['reste_a_payer', 'montant_restant', 'remaining']) ?? 0),
    }))
    .filter(({ remaining }) => remaining > 0);

  const debtorKeys = new Set(debtSales.map(({ sale }) => String(
    firstValue(sale, [
      'debiteur_id',
      'client_debiteur_id',
      'nom_client_debiteur',
      'nom_debiteur',
    ]) || rowId(sale),
  )));
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  // paiements_dettes.montant mirrors reste_a_payer (outstanding).
  // "Collected today" comes from ventes paid today, not from outstanding rows.
  const collectedToday = sum(
    ventes.filter((sale) => inPeriod(
      parseDate(sale, 'ventes'),
      startOfToday.getTime(),
      endOfToday.getTime(),
    )),
    saleCollectedAmount,
  );

  const outstandingFromPayments = sum(
    payments.filter((payment) => (firstNumber(payment, PAYMENT_AMOUNT_FIELDS) ?? 0) > 0),
    paymentAmount,
  );

  return {
    totalDebt: sum(debtSales, ({ total }) => total),
    debtorCount: debtorKeys.size,
    collectedToday,
    remaining: debtSales.length
      ? sum(debtSales, ({ remaining }) => remaining)
      : outstandingFromPayments,
  };
}

function movementQuantity(stock) {
  const initial = firstNumber(stock, STOCK_INITIAL_FIELDS);
  const entries = firstNumber(stock, STOCK_ENTRY_FIELDS);
  const exits = firstNumber(stock, STOCK_EXIT_FIELDS);
  if (initial !== null || entries !== null || exits !== null) {
    return (initial ?? 0) + (entries ?? 0) - (exits ?? 0);
  }

  const quantity = firstNumber(stock, STOCK_FALLBACK_QUANTITY_FIELDS) ?? 0;
  const movementType = String(firstValue(stock, ['type_mouvement', 'movement_type', 'type']) || '').toLowerCase();
  return /(sortie|retrait|vente|decrease|out)/.test(movementType)
    ? -Math.abs(quantity)
    : quantity;
}

function percentChange(current, previous) {
  if (!current && !previous) return null;
  if (!previous) return current > 0 ? 100 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function sum(items, selector) {
  return items.reduce((total, item) => total + selector(item), 0);
}

function inPeriod(date, start, end) {
  if (!date) return false;
  const time = date.getTime();
  return time >= start && time < end;
}

function periodTotals(ventes, depenses, productById, products, now) {
  const currentStart = now - (7 * DAY_MS);
  const previousStart = now - (14 * DAY_MS);

  const calculate = (start, end) => {
    const periodSales = ventes.filter((sale) => inPeriod(parseDate(sale, 'ventes'), start, end));
    const periodExpenses = depenses.filter((expense) => inPeriod(parseDate(expense, 'depenses'), start, end));
    // Realized CA (encashed + credit), not cash collections only.
    const revenue = sum(periodSales, (sale) => saleRevenueAmount(sale, resolveProduct(sale, productById, products)));
    const collections = sum(periodSales, saleCollectedAmount);
    const expenses = sum(periodExpenses, expenseAmount);
    return { revenue, collections, expenses, profit: revenue - expenses };
  };

  const current = calculate(currentStart, now + 1);
  const previous = calculate(previousStart, currentStart);
  return {
    current,
    previous,
    salesChange: percentChange(current.revenue, previous.revenue),
    collectionsChange: percentChange(current.collections, previous.collections),
    expenseChange: percentChange(current.expenses, previous.expenses),
    profitChange: percentChange(current.profit, previous.profit),
  };
}

function calculateInventory(products, stocks, ventes, productById) {
  const stockRowsByProduct = new Map();

  stocks.forEach((stock) => {
    const product = resolveProduct(stock, productById, products);
    const id = product ? rowId(product) : relatedProductId(stock);
    if (!id) return;
    const rows = stockRowsByProduct.get(id) || [];
    rows.push(stock);
    stockRowsByProduct.set(id, rows);
  });

  return products.map((product) => {
    const id = rowId(product);
    const stockRows = (stockRowsByProduct.get(id) || [])
      .slice()
      .sort((a, b) => (parseDate(b, 'stocks')?.getTime() || 0) - (parseDate(a, 'stocks')?.getTime() || 0));
    const safeQuantity = Math.max(0, sum(stockRows, movementQuantity));
    const purchasePrice = Math.max(0, firstNumber(product, PRODUCT_PURCHASE_PRICE_FIELDS) ?? 0);
    const configuredThreshold = firstNumber(product, ['seuil_alerte', 'stock_minimum', 'seuil_stock', 'reorder_level'])
      ?? (stockRows.length ? firstNumber(stockRows[0], ['seuil_alerte', 'stock_minimum', 'seuil_stock']) : null);
    const soldLastWeek = sum(
      ventes.filter((sale) => {
        const matched = resolveProduct(sale, productById, products);
        return (matched ? rowId(matched) : relatedProductId(sale)) === id
          && inPeriod(parseDate(sale, 'ventes'), Date.now() - (7 * DAY_MS), Date.now() + 1);
      }),
      saleQuantity,
    );
    const threshold = Math.max(1, configuredThreshold ?? Math.ceil(soldLastWeek || 5));

    return {
      id,
      name: productName(product),
      category: productCategory(product),
      quantity: safeQuantity,
      purchasePrice,
      value: safeQuantity * purchasePrice,
      threshold,
      isLow: safeQuantity <= threshold,
      product: productById.get(id),
    };
  });
}

function buildTimeline(ventes, depenses, productById, products) {
  const days = new Map();
  const ensureDay = (date) => {
    if (!date) return null;
    const key = date.toISOString().slice(0, 10);
    if (!days.has(key)) {
      days.set(key, {
        key,
        date: date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
        ventes: 0,
        depenses: 0,
        benefice: 0,
      });
    }
    return days.get(key);
  };

  ventes.forEach((sale) => {
    const point = ensureDay(parseDate(sale, 'ventes'));
    if (!point) return;
    const product = resolveProduct(sale, productById, products);
    // Graph CA = ventes réalisées (encaissées + créances).
    const revenue = saleRevenueAmount(sale, product);
    point.ventes += revenue;
    point.benefice += revenue;
  });

  depenses.forEach((expense) => {
    const point = ensureDay(parseDate(expense, 'depenses'));
    if (!point) return;
    const amount = expenseAmount(expense);
    point.depenses += amount;
    // Bénéfice période = CA − dépenses (pas de coût d'achat ici).
    point.benefice -= amount;
  });

  return Array.from(days.values())
    .sort((a, b) => a.key.localeCompare(b.key));
}

function buildTopProducts(ventes, productById, products) {
  const grouped = new Map();
  ventes.forEach((sale) => {
    const product = resolveProduct(sale, productById, products);
    const name = saleProductName(sale, product);
    const current = grouped.get(name) || { name, quantite: 0, ventes: 0 };
    current.quantite += saleQuantity(sale);
    current.ventes += saleAmount(sale, product);
    grouped.set(name, current);
  });

  return Array.from(grouped.values())
    .filter((item) => item.quantite > 0 || item.ventes > 0)
    .sort((a, b) => (b.quantite - a.quantite) || (b.ventes - a.ventes))
    .slice(0, 6);
}

function buildCategorySales(ventes, productById, products) {
  const grouped = new Map();
  ventes.forEach((sale) => {
    const product = resolveProduct(sale, productById, products);
    const category = saleCategory(sale, product);
    grouped.set(category, (grouped.get(category) || 0) + saleAmount(sale, product));
  });

  return Array.from(grouped, ([name, value]) => ({ name, value }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
}

function buildActivities(ventes, depenses, products, stocks, payments, productById) {
  const saleById = new Map(ventes.map((sale) => [rowId(sale), sale]));
  const salesActivities = ventes.map((sale) => {
    const product = resolveProduct(sale, productById, products);
    const quantity = saleQuantity(sale);
    return {
      id: `vente-${rowId(sale)}`,
      type: 'vente',
      title: 'Vente enregistrée',
      detail: `${quantity ? `${quantity} × ` : ''}${saleProductName(sale, product)}`,
      amount: saleAmount(sale, product),
      date: parseDate(sale, 'ventes'),
    };
  });

  const expenseActivities = depenses.map((expense) => ({
    id: `depense-${rowId(expense)}`,
    type: 'depense',
    title: 'Dépense enregistrée',
    detail: cleanUtf8Text(firstValue(expense, EXPENSE_NAME_FIELDS) || 'Dépense'),
    amount: expenseAmount(expense),
    date: parseDate(expense, 'depenses'),
  }));

  const productActivities = products.map((product) => ({
    id: `produit-${rowId(product)}`,
    type: 'produit',
    title: 'Produit créé',
    detail: productName(product),
    amount: null,
    date: parseDate(product, 'produits'),
  }));

  const stockActivities = stocks.map((stock) => {
    const product = resolveProduct(stock, productById, products);
    const label = product
      ? productName(product)
      : cleanUtf8Text(firstValue(stock, PRODUCT_NAME_FIELDS) || 'Produit');
    return {
      id: `stock-${rowId(stock)}`,
      type: 'stock',
      title: 'Stock ajouté',
      detail: `${Math.abs(movementQuantity(stock)) || 0} × ${label}`,
      amount: null,
      date: parseDate(stock, 'stocks'),
    };
  });

  const paymentActivities = payments
    .map((payment) => {
      const sale = saleById.get(String(firstValue(payment, ['vente_id', 'sale_id']) || ''));
      const product = sale ? resolveProduct(sale, productById, products) : null;
      const outstanding = paymentAmount(payment);
      const settled = outstanding <= 0;
      return {
        id: `paiement-${rowId(payment)}`,
        type: 'paiement',
        title: settled ? 'Dette soldée' : 'Dette restante',
        detail: sale ? saleProductName(sale, product) : 'Dette client',
        amount: outstanding,
        date: parseDate(payment, 'paiements_dettes'),
      };
    })
    .filter((activity) => activity.amount > 0 || activity.title === 'Dette soldée');

  return [
    ...salesActivities,
    ...expenseActivities,
    ...productActivities,
    ...stockActivities,
    ...paymentActivities,
  ]
    .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
    .slice(0, 5);
}

function buildAlerts(inventory, trends, depenses, metrics, debts) {
  const alerts = inventory
    .filter((item) => item.isLow)
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, 3)
    .map((item) => ({
      id: `stock-${item.id}`,
      type: 'stock',
      tone: item.quantity === 0 ? 'danger' : 'warning',
      title: item.quantity === 0 ? 'Produit en rupture' : 'Produit bientôt en rupture',
      message: `${item.name} : ${item.quantity.toLocaleString('fr-FR')} unité${item.quantity > 1 ? 's' : ''} restante${item.quantity > 1 ? 's' : ''}.`,
    }));

  const expenseValues = depenses.map(expenseAmount).filter((amount) => amount > 0);
  if (expenseValues.length >= 3) {
    const average = sum(expenseValues, (value) => value) / expenseValues.length;
    const variance = sum(expenseValues, (value) => ((value - average) ** 2)) / expenseValues.length;
    const unusual = depenses
      .map((expense) => ({ expense, amount: expenseAmount(expense) }))
      .filter(({ amount }) => amount > average + (2 * Math.sqrt(variance)))
      .sort((a, b) => b.amount - a.amount)[0];
    if (unusual) {
      alerts.push({
        id: `expense-${rowId(unusual.expense)}`,
        type: 'depense',
        tone: 'danger',
        title: 'Dépense inhabituelle',
        message: `${cleanUtf8Text(firstValue(unusual.expense, EXPENSE_NAME_FIELDS) || 'Une dépense')} dépasse nettement votre moyenne habituelle.`,
      });
    }
  }

  if (metrics.profit < 0) {
    alerts.push({
      id: 'negative-profit',
      type: 'benefice',
      tone: 'danger',
      title: 'Bénéfice négatif',
      message: 'Vos dépenses et coûts dépassent actuellement votre chiffre d’affaires.',
    });
  }

  if (debts.remaining > 0) {
    const isImportant = debts.remaining >= Math.max(metrics.revenue * 0.25, 1);
    alerts.push({
      id: 'client-debt',
      type: 'dette',
      tone: isImportant ? 'danger' : 'warning',
      title: isImportant ? 'Dettes clients importantes' : 'Dettes clients',
      message: `${debts.debtorCount} client${debts.debtorCount > 1 ? 's' : ''} débiteur${debts.debtorCount > 1 ? 's' : ''} à relancer.`,
    });
  }

  if (trends.salesChange !== null) {
    alerts.push({
      id: 'sales-trend',
      type: 'vente',
      tone: trends.salesChange >= 0 ? 'positive' : 'warning',
      title: 'Évolution des ventes',
      message: `Vos ventes ${trends.salesChange >= 0 ? 'progressent' : 'reculent'} de ${Math.abs(trends.salesChange).toFixed(0)} % par rapport à la semaine précédente.`,
    });
  }

  if (trends.profitChange !== null) {
    alerts.push({
      id: 'profit-trend',
      type: 'benefice',
      tone: trends.profitChange >= 0 ? 'positive' : 'warning',
      title: 'Évolution du bénéfice',
      message: `Votre bénéfice estimé ${trends.profitChange >= 0 ? 'progresse' : 'recule'} de ${Math.abs(trends.profitChange).toFixed(0)} % sur une semaine.`,
    });
  }

  return alerts;
}

function buildInsights(inventory, trends, topProducts, debts) {
  const insights = [];

  if (trends.salesChange !== null) {
    insights.push(`Vos ventes ${trends.salesChange >= 0 ? 'augmentent' : 'diminuent'} de ${Math.abs(trends.salesChange).toFixed(0)} % cette semaine.`);
  }
  if (trends.expenseChange !== null) {
    insights.push(`Vos dépenses ${trends.expenseChange >= 0 ? 'augmentent' : 'diminuent'} de ${Math.abs(trends.expenseChange).toFixed(0)} % par rapport à la semaine précédente.`);
  }

  const lowestStock = inventory
    .filter((item) => item.isLow)
    .sort((a, b) => a.quantity - b.quantity)[0];
  if (lowestStock) {
    insights.push(`Le produit « ${lowestStock.name} » ${lowestStock.quantity === 0 ? 'est en rupture' : 'sera bientôt en rupture'}.`);
  }

  if (trends.profitChange !== null) {
    insights.push(`Votre bénéfice estimé ${trends.profitChange >= 0 ? 'progresse' : 'recule'} par rapport à la semaine précédente.`);
  }

  if (debts.remaining > 0) {
    insights.push(`${debts.debtorCount} client${debts.debtorCount > 1 ? 's ont' : ' a'} encore un paiement à régulariser.`);
  }

  if (topProducts[0]) {
    insights.push(`« ${topProducts[0].name} » est actuellement votre produit le plus vendu.`);
  }

  return insights.slice(0, 4);
}

/**
 * Map synthese_mensuelle columns → dashboard KPI cards:
 *   total_recettes → Encaissements (cash collected = sum montant_paye)
 *   total_depenses → Dépenses
 *   benefice_net   → Bénéfice estimé (encaissements − dépenses in the view)
 *   dette_client   → Dettes clients (sum reste_a_payer)
 * Sums all monthly rows (full history via the monthly view).
 */
function metricsFromSynthese(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return {
    // Kept as `revenue` in metrics object for compatibility; UI label = Encaissements.
    revenue: sum(rows, (row) => Math.max(0, toNumber(row.total_recettes) ?? 0)),
    expenses: sum(rows, (row) => Math.max(0, toNumber(row.total_depenses) ?? 0)),
    profit: sum(rows, (row) => toNumber(row.benefice_net) ?? 0),
    clientDebt: sum(rows, (row) => Math.max(0, toNumber(row.dette_client) ?? 0)),
  };
}

export function buildDashboardAnalytics({
  produits = [],
  stocks = [],
  ventes = [],
  depenses = [],
  paiements_dettes = [],
  synthese_mensuelle = [],
}) {
  const productById = new Map(produits.map((product) => [rowId(product), product]));
  const fromSynthese = metricsFromSynthese(synthese_mensuelle);
  // Top-card "Encaissements" = cash collected only.
  const collectionsFallback = sum(ventes, saleCollectedAmount);
  const expensesFallback = sum(depenses, expenseAmount);
  const inventory = calculateInventory(produits, stocks, ventes, productById);
  const trends = periodTotals(ventes, depenses, productById, produits, Date.now());
  const topProducts = buildTopProducts(ventes, productById, produits);
  const debtMetrics = buildDebtMetrics(ventes, paiements_dettes);
  const recentTopProducts = buildTopProducts(
    ventes.filter((sale) => inPeriod(
      parseDate(sale, 'ventes'),
      Date.now() - (7 * DAY_MS),
      Date.now() + 1,
    )),
    productById,
    produits,
  );

  const revenue = fromSynthese?.revenue ?? collectionsFallback;
  const expenses = fromSynthese?.expenses ?? expensesFallback;
  // Top-card profit stays aligned with synthese (encaissements − dépenses).
  const profit = fromSynthese?.profit ?? (collectionsFallback - expensesFallback);
  const clientDebt = fromSynthese?.clientDebt ?? debtMetrics.remaining;
  const debts = fromSynthese
    ? { ...debtMetrics, remaining: clientDebt }
    : debtMetrics;

  const metrics = {
    revenue,
    expenses,
    profit,
    stockValue: sum(inventory, (item) => item.value),
    productCount: produits.length,
    stockQuantity: sum(inventory, (item) => item.quantity),
    clientDebt,
  };

  return {
    metrics,
    trends,
    timeline: buildTimeline(ventes, depenses, productById, produits),
    topProducts,
    categorySales: buildCategorySales(ventes, productById, produits),
    activities: buildActivities(
      ventes,
      depenses,
      produits,
      stocks,
      paiements_dettes,
      productById,
    ),
    alerts: buildAlerts(inventory, trends, depenses, metrics, debts),
    insights: buildInsights(inventory, trends, recentTopProducts, debts),
    debts,
    inventory,
  };
}
