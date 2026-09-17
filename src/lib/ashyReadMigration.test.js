import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAshyReadExpensesMigrated,
  isAshyReadProductsMigrated,
  isAshyReadSalesMigrated,
  isAshyReadStockMigrated,
  isExpensesReadIntent,
  isMigratedReadIntent,
  isProductsReadIntent,
  isSalesReadIntent,
  isStockReadIntent,
  READ_CAPABILITY,
} from './ashyReadMigration.js';
import { CHAT_ROUTE, resolveChatRoute } from './chatRouter.js';

const FLAG_OFF = { VITE_ASHY_READ_CHAT: 'false', VITE_ASHY_WRITE_CHAT: 'false' };
const SALES_ROLLBACK = { ...FLAG_OFF, VITE_ASHY_READ_SALES: 'false' };
const EXPENSES_ON = { ...FLAG_OFF, VITE_ASHY_READ_EXPENSES: 'true' };
const EXPENSES_ROLLBACK = { ...FLAG_OFF, VITE_ASHY_READ_EXPENSES: 'false' };
const H122_ON = { ...FLAG_OFF, VITE_ASHY_READ_EXPENSES: 'true' };
const H123_ON = { ...FLAG_OFF, VITE_ASHY_READ_EXPENSES: 'true', VITE_ASHY_READ_STOCK: 'true' };
const H124_ON = { ...H123_ON, VITE_ASHY_READ_PRODUCTS: 'true' };
const STOCK_ROLLBACK = { ...FLAG_OFF, VITE_ASHY_READ_STOCK: 'false' };
const PRODUCTS_ROLLBACK = { ...H123_ON, VITE_ASHY_READ_PRODUCTS: 'false' };

test('isAshyReadSalesMigrated defaults ON for H12.1 rollback via false', () => {
  assert.equal(isAshyReadSalesMigrated({}), true);
  assert.equal(isAshyReadSalesMigrated({ VITE_ASHY_READ_SALES: 'true' }), true);
  assert.equal(isAshyReadSalesMigrated({ VITE_ASHY_READ_SALES: 'false' }), false);
});

test('isAshyReadExpensesMigrated defaults OFF; true enables H12.2', () => {
  assert.equal(isAshyReadExpensesMigrated({}), false);
  assert.equal(isAshyReadExpensesMigrated({ VITE_ASHY_READ_EXPENSES: 'false' }), false);
  assert.equal(isAshyReadExpensesMigrated({ VITE_ASHY_READ_EXPENSES: 'true' }), true);
});

test('isSalesReadIntent detects sales reads not writes', () => {
  assert.equal(isSalesReadIntent('Quelles sont mes ventes ?'), true);
  assert.equal(isSalesReadIntent('Combien ai-je vendu ce mois-ci ?'), true);
  assert.equal(isSalesReadIntent('Et mes ventes ?'), true);
  assert.equal(isSalesReadIntent("J'ai vendu 10 pains à 2 $"), false);
  assert.equal(isSalesReadIntent('Quelles sont mes dépenses ?'), false);
});

test('H12.2 isExpensesReadIntent detects expenses reads not writes', () => {
  assert.equal(isExpensesReadIntent('Quelles sont mes dépenses ?'), true);
  assert.equal(isExpensesReadIntent('Montre-moi mes dépenses'), true);
  assert.equal(isExpensesReadIntent('Combien ai-je dépensé ?'), true);
  assert.equal(isExpensesReadIntent('Et mes dépenses ?'), true);
  assert.equal(isExpensesReadIntent("J'ai dépensé 30 dollars"), false);
  assert.equal(isExpensesReadIntent("J'ai dépensé de l'argent pour le transport"), false);
  assert.equal(isExpensesReadIntent('Ajoute une dépense de 30 dollars'), false);
  assert.equal(isExpensesReadIntent('Enregistre une dépense de 20 dollars'), false);
  assert.equal(isExpensesReadIntent('Quelles sont mes ventes ?'), false);
});

test('H12.1 sales migration routes to ashy with global read flag OFF', () => {
  assert.equal(
    resolveChatRoute('Quelles sont mes ventes ?', { env: FLAG_OFF }),
    CHAT_ROUTE.ASHY,
  );
  assert.equal(
    resolveChatRoute('Quelles sont mes dépenses ?', { env: FLAG_OFF }),
    CHAT_ROUTE.N8N,
  );
});

test('H12.2 expenses migration routes to ashy with global read flag OFF when flag ON', () => {
  assert.equal(
    resolveChatRoute('Quelles sont mes dépenses ?', { env: H122_ON }),
    CHAT_ROUTE.ASHY,
  );
  assert.equal(
    resolveChatRoute('Montre-moi mes dépenses', { env: H122_ON }),
    CHAT_ROUTE.ASHY,
  );
  assert.equal(
    resolveChatRoute('Combien ai-je dépensé ?', { env: H122_ON }),
    CHAT_ROUTE.ASHY,
  );
});

test('H12.2 expenses flag OFF keeps legacy n8n routing', () => {
  assert.equal(
    resolveChatRoute('Quelles sont mes dépenses ?', { env: EXPENSES_ROLLBACK }),
    CHAT_ROUTE.N8N,
  );
});

test('H12.1 sales rollback restores n8n for sales read', () => {
  assert.equal(
    resolveChatRoute('Quelles sont mes ventes ?', { env: SALES_ROLLBACK }),
    CHAT_ROUTE.N8N,
  );
});

test('H12.2 sales stays V2 when expenses flag enabled', () => {
  assert.equal(
    resolveChatRoute('Quelles sont mes ventes ?', { env: H122_ON }),
    CHAT_ROUTE.ASHY,
  );
});

test('H12.2 write safety — expense writes not routed as migrated read', () => {
  const writeOn = { ...H122_ON, VITE_ASHY_WRITE_CHAT: 'true' };
  assert.equal(
    resolveChatRoute("J'ai dépensé 30 dollars", { env: writeOn }),
    CHAT_ROUTE.ASHY,
  );
  assert.equal(
    resolveChatRoute("J'ai dépensé de l'argent pour le transport", { env: writeOn }),
    CHAT_ROUTE.ASHY,
  );
  assert.equal(
    resolveChatRoute('Ajoute une dépense de 30 dollars', { env: writeOn }),
    CHAT_ROUTE.N8N,
  );
  assert.equal(
    resolveChatRoute("J'ai dépensé 30 dollars", { env: H122_ON }),
    CHAT_ROUTE.N8N,
  );
});

test('H12.2 regression — stock/products/debts not migrated without stock flag', () => {
  assert.equal(resolveChatRoute('Quel est mon stock ?', { env: H122_ON }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Liste mes produits', { env: H122_ON }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Qui me doit de l\'argent ?', { env: H122_ON }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Génère mon bilan PDF', { env: H122_ON }), CHAT_ROUTE.N8N);
});

test('isAshyReadStockMigrated defaults OFF; true enables H12.3', () => {
  assert.equal(isAshyReadStockMigrated({}), false);
  assert.equal(isAshyReadStockMigrated({ VITE_ASHY_READ_STOCK: 'false' }), false);
  assert.equal(isAshyReadStockMigrated({ VITE_ASHY_READ_STOCK: 'true' }), true);
});

test('H12.3 isStockReadIntent detects stock reads not writes', () => {
  assert.equal(isStockReadIntent('Quel est mon stock ?'), true);
  assert.equal(isStockReadIntent('Montre-moi mon stock'), true);
  assert.equal(isStockReadIntent('Quels sont mes stocks ?'), true);
  assert.equal(isStockReadIntent('Combien me reste-t-il de poulets ?'), true);
  assert.equal(isStockReadIntent('Quels produits me restent ?'), true);
  assert.equal(isStockReadIntent('Ajoute 10 poulets au stock'), false);
  assert.equal(isStockReadIntent('Retire 5 poulets du stock'), false);
  assert.equal(isStockReadIntent('Corrige mon stock'), false);
  assert.equal(isStockReadIntent("J'ai reçu 10 produits"), false);
  assert.equal(isStockReadIntent("J'ai vendu 2 poulets"), false);
  assert.equal(isStockReadIntent('Liste mes produits'), false);
});

test('H12.3 stock migration routes to ashy when flag ON', () => {
  assert.equal(resolveChatRoute('Quel est mon stock ?', { env: H123_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Montre-moi mon stock', { env: H123_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Combien me reste-t-il de poulets ?', { env: H123_ON }), CHAT_ROUTE.ASHY);
});

test('H12.3 stock flag OFF keeps legacy n8n routing', () => {
  assert.equal(resolveChatRoute('Quel est mon stock ?', { env: STOCK_ROLLBACK }), CHAT_ROUTE.N8N);
});

test('H12.3 sales and expenses stay V2 when stock flag enabled', () => {
  assert.equal(resolveChatRoute('Quelles sont mes ventes ?', { env: H123_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Quelles sont mes dépenses ?', { env: H123_ON }), CHAT_ROUTE.ASHY);
});

test('H12.3 write safety — stock writes not routed as migrated read', () => {
  const writeOn = { ...H123_ON, VITE_ASHY_WRITE_CHAT: 'true' };
  assert.equal(resolveChatRoute('Ajoute 10 poulets au stock', { env: writeOn }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Retire 5 poulets du stock', { env: writeOn }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute("J'ai reçu 10 produits", { env: writeOn }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute("J'ai vendu 2 poulets", { env: writeOn }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Corrige mon stock', { env: H123_ON }), CHAT_ROUTE.N8N);
});

test('H12.3 regression — products/debts/pdf not migrated', () => {
  assert.equal(resolveChatRoute('Liste mes produits', { env: H123_ON }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Qui me doit de l\'argent ?', { env: H123_ON }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Génère mon bilan PDF', { env: H123_ON }), CHAT_ROUTE.N8N);
});

test('isMigratedReadIntent matches SALES and EXPENSES capabilities', () => {
  assert.equal(isMigratedReadIntent(READ_CAPABILITY.SALES, 'Quelles sont mes ventes ?'), true);
  assert.equal(isMigratedReadIntent(READ_CAPABILITY.SALES, 'Quelles sont mes dépenses ?'), false);
  assert.equal(
    isMigratedReadIntent(READ_CAPABILITY.EXPENSES, 'Quelles sont mes dépenses ?', EXPENSES_ON),
    true,
  );
  assert.equal(
    isMigratedReadIntent(READ_CAPABILITY.EXPENSES, 'Quelles sont mes dépenses ?', EXPENSES_ROLLBACK),
    false,
  );
  assert.equal(
    isMigratedReadIntent(READ_CAPABILITY.STOCK, 'Quel est mon stock ?', H123_ON),
    true,
  );
  assert.equal(
    isMigratedReadIntent(READ_CAPABILITY.STOCK, 'Quel est mon stock ?', STOCK_ROLLBACK),
    false,
  );
});

test('isAshyReadProductsMigrated defaults OFF; true enables H12.4', () => {
  assert.equal(isAshyReadProductsMigrated({}), false);
  assert.equal(isAshyReadProductsMigrated({ VITE_ASHY_READ_PRODUCTS: 'false' }), false);
  assert.equal(isAshyReadProductsMigrated({ VITE_ASHY_READ_PRODUCTS: 'true' }), true);
});

test('H12.4 isProductsReadIntent detects catalog reads not writes', () => {
  assert.equal(isProductsReadIntent('Liste mes produits'), true);
  assert.equal(isProductsReadIntent('Montre-moi mes produits'), true);
  assert.equal(isProductsReadIntent('Quels sont mes produits ?'), true);
  assert.equal(isProductsReadIntent('Quels produits ai-je ?'), true);
  assert.equal(isProductsReadIntent('Donne-moi la liste de mes produits'), true);
  assert.equal(isProductsReadIntent('Quels produits sont enregistrés ?'), true);
  assert.equal(isProductsReadIntent('Ajoute un produit'), false);
  assert.equal(isProductsReadIntent('Crée un produit'), false);
  assert.equal(isProductsReadIntent('Modifie le prix du poulet'), false);
  assert.equal(isProductsReadIntent('Supprime le produit poulet'), false);
  assert.equal(isProductsReadIntent('Combien me reste-t-il de poulets ?'), false);
  assert.equal(isProductsReadIntent('Quel est mon stock ?'), false);
  assert.equal(isProductsReadIntent('Quel est le prix du poulet ?'), false);
  assert.equal(isProductsReadIntent('Combien coûte mon poulet ?'), false);
});

test('H12.4 products migration routes to ashy when flag ON', () => {
  assert.equal(resolveChatRoute('Liste mes produits', { env: H124_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Montre-moi mes produits', { env: H124_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Quels produits ai-je ?', { env: H124_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Donne-moi la liste de mes produits', { env: H124_ON }), CHAT_ROUTE.ASHY);
});

test('H12.4 products flag OFF keeps legacy n8n routing', () => {
  assert.equal(resolveChatRoute('Liste mes produits', { env: PRODUCTS_ROLLBACK }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Montre-moi mes produits', { env: PRODUCTS_ROLLBACK }), CHAT_ROUTE.N8N);
});

test('H12.4 sales expenses stock stay V2 when products flag enabled', () => {
  assert.equal(resolveChatRoute('Quelles sont mes ventes ?', { env: H124_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Quelles sont mes dépenses ?', { env: H124_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Quel est mon stock ?', { env: H124_ON }), CHAT_ROUTE.ASHY);
});

test('H12.4 write safety — product writes not routed as migrated read', () => {
  const writeOn = { ...H124_ON, VITE_ASHY_WRITE_CHAT: 'true' };
  assert.equal(resolveChatRoute('Ajoute un produit', { env: writeOn }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Crée un produit', { env: writeOn }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Modifie le prix du poulet', { env: writeOn }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Supprime le produit poulet', { env: writeOn }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Ajoute un produit', { env: H124_ON }), CHAT_ROUTE.N8N);
});

test('H12.4 stock regression — stock reads stay stock not products', () => {
  assert.equal(resolveChatRoute('Quel est mon stock ?', { env: H124_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Combien me reste-t-il de poulets ?', { env: H124_ON }), CHAT_ROUTE.ASHY);
  assert.equal(isProductsReadIntent('Combien me reste-t-il de poulets ?'), false);
});

test('H12.4 regression — debts/profit/pdf and price gaps not migrated', () => {
  assert.equal(resolveChatRoute('Qui me doit de l\'argent ?', { env: H124_ON }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Génère mon bilan PDF', { env: H124_ON }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Quel est le prix du poulet ?', { env: H124_ON }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Combien coûte mon poulet ?', { env: H124_ON }), CHAT_ROUTE.N8N);
});

test('isMigratedReadIntent matches PRODUCTS capability', () => {
  assert.equal(
    isMigratedReadIntent(READ_CAPABILITY.PRODUCTS, 'Liste mes produits', H124_ON),
    true,
  );
  assert.equal(
    isMigratedReadIntent(READ_CAPABILITY.PRODUCTS, 'Liste mes produits', PRODUCTS_ROLLBACK),
    false,
  );
});
