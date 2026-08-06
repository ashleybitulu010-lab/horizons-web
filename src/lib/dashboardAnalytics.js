const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_FIELDS = {
  ventes: ['date_vente', 'sold_at', 'date', 'created_at', 'created'],
  depenses: ['date_depense', 'spent_at', 'date', 'created_at', 'created'],
  produits: ['created_at', 'created', 'date_creation', 'date'],
  stocks: ['date_stock', 'date_mouvement', 'created_at', 'created', 'date'],
};

const PRODUCT_NAME_FIELDS = ['nom_produit', 'nom', 'name', 'libelle', 'designation'];
const PRODUCT_CATEGORY_FIELDS = ['categorie', 'category', 'nom_categorie', 'type'];
const PRODUCT_PURCHASE_PRICE_FIELDS = ['prix_achat', 'cout_achat', 'purchase_price', 'cost_price', 'cout_unitaire'];
const PRODUCT_SALE_PRICE_FIELDS = ['prix_vente', 'sale_price', 'selling_price', 'prix_unitaire'];
const PRODUCT_STOCK_FIELDS = [
  'stock_actuel',
  'quantite_stock',
  'quantite_disponible',
  'quantite_restante',
  'current_stock',
  'stock',
];
const STOCK_CURRENT_FIELDS = [
  'stock_apres',
  'nouvelle_quantite',
  'quantite_restante',
  'stock_actuel',
  'current_stock',
];
const STOCK_QUANTITY_FIELDS = [
  'quantite_ajoutee',
  'quantite_entree',
  'quantite',
  'quantity',
  'mouvement',
];
const SALE_QUANTITY_FIELDS = ['quantite', 'quantity', 'quantite_vendue', 'qte', 'units'];
const SALE_AMOUNT_FIELDS = [
  'montant_total',
  'total_vente',
  'total',
  'montant',
  'chiffre_affaires',
  'amount',
];
const SALE_UNIT_PRICE_FIELDS = ['prix_unitaire', 'prix_vente', 'unit_price', 'sale_price'];
const EXPENSE_AMOUNT_FIELDS = ['montant', 'montant_total', 'total', 'amount', 'valeur'];
const EXPENSE_NAME_FIELDS = ['libelle', 'description', 'motif', 'nom_depense', 'categorie', 'category', 'type'];
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
  return String(row?.id ?? row?.uuid ?? '');
}

function relatedProductId(row) {
  const value = firstValue(row, PRODUCT_ID_FIELDS);
  if (value && typeof value === 'object') return String(value.id ?? '');
  return value === null ? '' : String(value);
}

function parseDate(row, type) {
  const raw = firstValue(row, DATE_FIELDS[type] || []);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function productName(product) {
  return String(firstValue(product, PRODUCT_NAME_FIELDS) || 'Produit sans nom');
}

function productCategory(product) {
  return String(firstValue(product, PRODUCT_CATEGORY_FIELDS) || 'Non catégorisé');
}

function saleProductName(sale, product) {
  return String(firstValue(sale, PRODUCT_NAME_FIELDS) || (product ? productName(product) : 'Produit'));
}

function saleCategory(sale, product) {
  return String(firstValue(sale, PRODUCT_CATEGORY_FIELDS) || (product ? productCategory(product) : 'Non catégorisé'));
}

function saleQuantity(sale) {
  return Math.max(0, firstNumber(sale, SALE_QUANTITY_FIELDS) ?? 0);
}

function saleAmount(sale, product) {
  const direct = firstNumber(sale, SALE_AMOUNT_FIELDS);
  if (direct !== null) return Math.max(0, direct);
  const unitPrice = firstNumber(sale, SALE_UNIT_PRICE_FIELDS)
    ?? firstNumber(product, PRODUCT_SALE_PRICE_FIELDS)
    ?? 0;
  return Math.max(0, saleQuantity(sale) * unitPrice);
}

function expenseAmount(expense) {
  return Math.max(0, firstNumber(expense, EXPENSE_AMOUNT_FIELDS) ?? 0);
}

function saleCost(sale, product) {
  const directCost = firstNumber(sale, ['cout_total', 'total_cost', 'cout_achat_total']);
  if (directCost !== null) return Math.max(0, directCost);
  return saleQuantity(sale) * Math.max(0, firstNumber(product, PRODUCT_PURCHASE_PRICE_FIELDS) ?? 0);
}

function movementQuantity(stock) {
  const quantity = firstNumber(stock, STOCK_QUANTITY_FIELDS) ?? 0;
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

function periodTotals(ventes, depenses, productById, now) {
  const currentStart = now - (7 * DAY_MS);
  const previousStart = now - (14 * DAY_MS);

  const calculate = (start, end) => {
    const periodSales = ventes.filter((sale) => inPeriod(parseDate(sale, 'ventes'), start, end));
    const periodExpenses = depenses.filter((expense) => inPeriod(parseDate(expense, 'depenses'), start, end));
    const revenue = sum(periodSales, (sale) => saleAmount(sale, productById.get(relatedProductId(sale))));
    const expenses = sum(periodExpenses, expenseAmount);
    const cost = sum(periodSales, (sale) => saleCost(sale, productById.get(relatedProductId(sale))));
    return { revenue, expenses, profit: revenue - expenses - cost };
  };

  const current = calculate(currentStart, now + 1);
  const previous = calculate(previousStart, currentStart);
  return {
    current,
    previous,
    salesChange: percentChange(current.revenue, previous.revenue),
    expenseChange: percentChange(current.expenses, previous.expenses),
    profitChange: percentChange(current.profit, previous.profit),
  };
}

function calculateInventory(products, stocks, ventes, productById) {
  const stockRowsByProduct = new Map();
  const soldByProduct = new Map();

  stocks.forEach((stock) => {
    const id = relatedProductId(stock);
    if (!id) return;
    const rows = stockRowsByProduct.get(id) || [];
    rows.push(stock);
    stockRowsByProduct.set(id, rows);
  });

  ventes.forEach((sale) => {
    const id = relatedProductId(sale);
    if (!id) return;
    soldByProduct.set(id, (soldByProduct.get(id) || 0) + saleQuantity(sale));
  });

  return products.map((product) => {
    const id = rowId(product);
    const directStock = firstNumber(product, PRODUCT_STOCK_FIELDS);
    const stockRows = (stockRowsByProduct.get(id) || [])
      .slice()
      .sort((a, b) => (parseDate(b, 'stocks')?.getTime() || 0) - (parseDate(a, 'stocks')?.getTime() || 0));

    let quantity = directStock;
    if (quantity === null) {
      const latestCurrent = stockRows.length ? firstNumber(stockRows[0], STOCK_CURRENT_FIELDS) : null;
      quantity = latestCurrent !== null
        ? latestCurrent
        : sum(stockRows, movementQuantity) - (soldByProduct.get(id) || 0);
    }

    const safeQuantity = Math.max(0, quantity ?? 0);
    const purchasePrice = Math.max(0, firstNumber(product, PRODUCT_PURCHASE_PRICE_FIELDS) ?? 0);
    const configuredThreshold = firstNumber(product, ['seuil_alerte', 'stock_minimum', 'seuil_stock', 'reorder_level']);
    const soldLastWeek = sum(
      ventes.filter((sale) => relatedProductId(sale) === id
        && inPeriod(parseDate(sale, 'ventes'), Date.now() - (7 * DAY_MS), Date.now() + 1)),
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

function buildTimeline(ventes, depenses, productById) {
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
    const product = productById.get(relatedProductId(sale));
    const revenue = saleAmount(sale, product);
    point.ventes += revenue;
    point.benefice += revenue - saleCost(sale, product);
  });

  depenses.forEach((expense) => {
    const point = ensureDay(parseDate(expense, 'depenses'));
    if (!point) return;
    const amount = expenseAmount(expense);
    point.depenses += amount;
    point.benefice -= amount;
  });

  return Array.from(days.values())
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(-30);
}

function buildTopProducts(ventes, productById) {
  const grouped = new Map();
  ventes.forEach((sale) => {
    const product = productById.get(relatedProductId(sale));
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

function buildCategorySales(ventes, productById) {
  const grouped = new Map();
  ventes.forEach((sale) => {
    const product = productById.get(relatedProductId(sale));
    const category = saleCategory(sale, product);
    grouped.set(category, (grouped.get(category) || 0) + saleAmount(sale, product));
  });

  return Array.from(grouped, ([name, value]) => ({ name, value }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
}

function buildActivities(ventes, depenses, products, stocks, productById) {
  const salesActivities = ventes.map((sale) => {
    const product = productById.get(relatedProductId(sale));
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
    detail: String(firstValue(expense, EXPENSE_NAME_FIELDS) || 'Dépense'),
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
    const product = productById.get(relatedProductId(stock));
    return {
      id: `stock-${rowId(stock)}`,
      type: 'stock',
      title: 'Stock ajouté',
      detail: `${Math.abs(movementQuantity(stock)) || 0} × ${product ? productName(product) : 'Produit'}`,
      amount: null,
      date: parseDate(stock, 'stocks'),
    };
  });

  return [...salesActivities, ...expenseActivities, ...productActivities, ...stockActivities]
    .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
    .slice(0, 10);
}

function buildAlerts(inventory, trends, depenses) {
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
        message: `${String(firstValue(unusual.expense, EXPENSE_NAME_FIELDS) || 'Une dépense')} dépasse nettement votre moyenne habituelle.`,
      });
    }
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

function buildInsights(inventory, trends, topProducts) {
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

  if (topProducts[0]) {
    insights.push(`« ${topProducts[0].name} » est actuellement votre produit le plus vendu.`);
  }

  return insights.slice(0, 4);
}

export function buildDashboardAnalytics({ produits = [], stocks = [], ventes = [], depenses = [] }) {
  const productById = new Map(produits.map((product) => [rowId(product), product]));
  const revenue = sum(ventes, (sale) => saleAmount(sale, productById.get(relatedProductId(sale))));
  const expenses = sum(depenses, expenseAmount);
  const soldCost = sum(ventes, (sale) => saleCost(sale, productById.get(relatedProductId(sale))));
  const inventory = calculateInventory(produits, stocks, ventes, productById);
  const trends = periodTotals(ventes, depenses, productById, Date.now());
  const topProducts = buildTopProducts(ventes, productById);

  const metrics = {
    revenue,
    expenses,
    profit: revenue - expenses - soldCost,
    stockValue: sum(inventory, (item) => item.value),
    productCount: produits.length,
    stockQuantity: sum(inventory, (item) => item.quantity),
  };

  return {
    metrics,
    trends,
    timeline: buildTimeline(ventes, depenses, productById),
    topProducts,
    categorySales: buildCategorySales(ventes, productById),
    activities: buildActivities(ventes, depenses, produits, stocks, productById),
    alerts: buildAlerts(inventory, trends, depenses),
    insights: buildInsights(inventory, trends, topProducts),
    inventory,
  };
}
