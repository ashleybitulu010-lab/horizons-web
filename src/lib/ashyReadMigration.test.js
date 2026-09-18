import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAshyReadDebtsMigrated,
  isAshyReadExpensesMigrated,
  isAshyReadProductsMigrated,
  isAshyReadProfitMigrated,
  isAshyReadSalesMigrated,
  isAshyReadStockMigrated,
  isDebtsReadIntent,
  isExpensesReadIntent,
  isMigratedReadIntent,
  isProductsReadIntent,
  isProfitReadIntent,
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
const H125_ON = { ...H124_ON, VITE_ASHY_READ_DEBTS: 'true' };
const H126_ON = { ...H125_ON, VITE_ASHY_READ_PROFIT: 'true' };
const STOCK_ROLLBACK = { ...FLAG_OFF, VITE_ASHY_READ_STOCK: 'false' };
const PRODUCTS_ROLLBACK = { ...H123_ON, VITE_ASHY_READ_PRODUCTS: 'false' };
const DEBTS_ROLLBACK = { ...H124_ON, VITE_ASHY_READ_DEBTS: 'false' };
const PROFIT_ROLLBACK = { ...H125_ON, VITE_ASHY_READ_PROFIT: 'false' };

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

test('isAshyReadDebtsMigrated defaults OFF; true enables H12.5', () => {
  assert.equal(isAshyReadDebtsMigrated({}), false);
  assert.equal(isAshyReadDebtsMigrated({ VITE_ASHY_READ_DEBTS: 'false' }), false);
  assert.equal(isAshyReadDebtsMigrated({ VITE_ASHY_READ_DEBTS: 'true' }), true);
});

test('H12.5 isDebtsReadIntent detects debt reads not writes', () => {
  assert.equal(isDebtsReadIntent('Quelles sont mes dettes ?'), true);
  assert.equal(isDebtsReadIntent('Montre-moi mes dettes'), true);
  assert.equal(isDebtsReadIntent('Qui me doit de l\'argent ?'), true);
  assert.equal(isDebtsReadIntent('Combien me doit-on ?'), true);
  assert.equal(isDebtsReadIntent('Quels sont mes clients débiteurs ?'), true);
  assert.equal(isDebtsReadIntent('Donne-moi la liste des débiteurs'), true);
  assert.equal(isDebtsReadIntent('Ajoute une dette de 50 dollars'), false);
  assert.equal(isDebtsReadIntent('Crée une dette'), false);
  assert.equal(isDebtsReadIntent('J\'ai payé 30 dollars de ma dette'), false);
  assert.equal(isDebtsReadIntent('Enregistre le paiement de ma dette'), false);
  assert.equal(isDebtsReadIntent('Ajoute un paiement de 20 dollars'), false);
  assert.equal(isDebtsReadIntent('Modifie la dette du client'), false);
  assert.equal(isDebtsReadIntent('Combien ai-je payé ?'), false);
  assert.equal(isDebtsReadIntent('Mes paiements'), false);
});

test('H12.5 debts migration routes to ashy when flag ON', () => {
  assert.equal(resolveChatRoute('Quelles sont mes dettes ?', { env: H125_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Qui me doit de l\'argent ?', { env: H125_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Combien me doit-on ?', { env: H125_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Donne-moi la liste des débiteurs', { env: H125_ON }), CHAT_ROUTE.ASHY);
});

test('H12.5 debts flag OFF keeps legacy n8n routing', () => {
  assert.equal(resolveChatRoute('Quelles sont mes dettes ?', { env: DEBTS_ROLLBACK }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Qui me doit de l\'argent ?', { env: DEBTS_ROLLBACK }), CHAT_ROUTE.N8N);
});

test('H12.5 sales expenses stock products stay V2 when debts flag enabled', () => {
  assert.equal(resolveChatRoute('Quelles sont mes ventes ?', { env: H125_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Quelles sont mes dépenses ?', { env: H125_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Quel est mon stock ?', { env: H125_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Liste mes produits', { env: H125_ON }), CHAT_ROUTE.ASHY);
});

test('H12.5 write safety — debt/payment writes not routed as migrated read', () => {
  const writeOn = { ...H125_ON, VITE_ASHY_WRITE_CHAT: 'true' };
  assert.equal(resolveChatRoute('Ajoute une dette de 50 dollars', { env: writeOn }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('J\'ai payé 30 dollars de ma dette', { env: writeOn }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Enregistre le paiement de ma dette', { env: writeOn }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Ajoute un paiement de 20 dollars', { env: writeOn }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('J\'ai payé 30 dollars de ma dette', { env: H125_ON }), CHAT_ROUTE.N8N);
});

test('H12.5 regression — profit/pdf and payment ambiguity not migrated', () => {
  assert.equal(resolveChatRoute('Génère mon bilan PDF', { env: H125_ON }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Combien ai-je payé ?', { env: H125_ON }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Mes paiements', { env: H125_ON }), CHAT_ROUTE.N8N);
});

test('isMigratedReadIntent matches DEBTS capability', () => {
  assert.equal(
    isMigratedReadIntent(READ_CAPABILITY.DEBTS, 'Quelles sont mes dettes ?', H125_ON),
    true,
  );
  assert.equal(
    isMigratedReadIntent(READ_CAPABILITY.DEBTS, 'Quelles sont mes dettes ?', DEBTS_ROLLBACK),
    false,
  );
});

test('isAshyReadProfitMigrated defaults OFF; true enables H12.6', () => {
  assert.equal(isAshyReadProfitMigrated({}), false);
  assert.equal(isAshyReadProfitMigrated({ VITE_ASHY_READ_PROFIT: 'false' }), false);
  assert.equal(isAshyReadProfitMigrated({ VITE_ASHY_READ_PROFIT: 'true' }), true);
});

test('H12.6 isProfitReadIntent detects profit/analysis reads not writes', () => {
  assert.equal(isProfitReadIntent('Quel est mon bénéfice ?'), true);
  assert.equal(isProfitReadIntent('Combien ai-je gagné ?'), true);
  assert.equal(isProfitReadIntent('Quel est mon profit ?'), true);
  assert.equal(isProfitReadIntent('Est-ce que j\'ai fait du bénéfice ?'), true);
  assert.equal(isProfitReadIntent('Analyse mes résultats'), true);
  assert.equal(isProfitReadIntent('Comment vont mes finances ?'), true);
  assert.equal(isProfitReadIntent('Pourquoi mon bénéfice a changé ?'), true);
  assert.equal(isProfitReadIntent('Compare mon bénéfice avec le mois passé'), true);
  assert.equal(isProfitReadIntent('Mon bénéfice a-t-il augmenté ?'), true);
  assert.equal(isProfitReadIntent('Quelle est ma marge ?'), true);
  assert.equal(isProfitReadIntent('Quel pourcentage de mes revenus part dans les dépenses ?'), true);
  assert.equal(isProfitReadIntent('Comment évolue mon bénéfice ?'), true);
  assert.equal(isProfitReadIntent('Combien ai-je vendu ?'), false);
  assert.equal(isProfitReadIntent('Combien ai-je dépensé ?'), false);
  assert.equal(isProfitReadIntent('Comment évoluent mes ventes ?'), false);
  assert.equal(isProfitReadIntent('Comment évoluent mes dépenses ?'), false);
  assert.equal(isProfitReadIntent('Quelle est l\'évolution de mon chiffre d\'affaires ?'), false);
  assert.equal(isProfitReadIntent('Ajoute une dépense de 30 dollars'), false);
  assert.equal(isProfitReadIntent('Enregistre une vente de 50 dollars'), false);
  assert.equal(isProfitReadIntent('Ajoute un paiement'), false);
});

test('H12.6 profit migration routes to ashy when flag ON', () => {
  assert.equal(resolveChatRoute('Quel est mon bénéfice ?', { env: H126_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Combien ai-je gagné ?', { env: H126_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Analyse mes résultats', { env: H126_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Comment vont mes finances ?', { env: H126_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Pourquoi mon bénéfice a changé ?', { env: H126_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Compare mon bénéfice avec le mois passé', { env: H126_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Quelle est ma marge ?', { env: H126_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Quel pourcentage de mes revenus part dans les dépenses ?', { env: H126_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Comment évolue mon bénéfice ?', { env: H126_ON }), CHAT_ROUTE.ASHY);
});

test('H12.6 profit flag OFF keeps legacy n8n routing', () => {
  assert.equal(resolveChatRoute('Quel est mon bénéfice ?', { env: PROFIT_ROLLBACK }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Analyse mes résultats', { env: PROFIT_ROLLBACK }), CHAT_ROUTE.N8N);
});

test('H12.6 sales/expenses/stock/products/debts stay V2 when profit flag enabled', () => {
  assert.equal(resolveChatRoute('Quelles sont mes ventes ?', { env: H126_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Quelles sont mes dépenses ?', { env: H126_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Quel est mon stock ?', { env: H126_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Liste mes produits', { env: H126_ON }), CHAT_ROUTE.ASHY);
  assert.equal(resolveChatRoute('Qui me doit de l\'argent ?', { env: H126_ON }), CHAT_ROUTE.ASHY);
});

test('H12.6 write safety — writes not routed as profit read', () => {
  const writeOn = { ...H126_ON, VITE_ASHY_WRITE_CHAT: 'true' };
  assert.equal(resolveChatRoute('Ajoute une dépense de 30 dollars', { env: writeOn }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Enregistre une vente de 50 dollars', { env: writeOn }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Ajoute un paiement', { env: writeOn }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Ajoute une dépense de 30 dollars', { env: H126_ON }), CHAT_ROUTE.N8N);
});

test('H12.6 regression — pdf and sales/expenses evolution stay non-profit', () => {
  assert.equal(resolveChatRoute('Génère mon bilan PDF', { env: H126_ON }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Comment évoluent mes ventes ?', { env: H126_ON }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Comment évoluent mes dépenses ?', { env: H126_ON }), CHAT_ROUTE.N8N);
  assert.equal(isSalesReadIntent('Quelle est l\'évolution de mon chiffre d\'affaires ?'), false);
});

test('isMigratedReadIntent matches PROFIT capability', () => {
  assert.equal(
    isMigratedReadIntent(READ_CAPABILITY.PROFIT, 'Quel est mon bénéfice ?', H126_ON),
    true,
  );
  assert.equal(
    isMigratedReadIntent(READ_CAPABILITY.PROFIT, 'Quel est mon bénéfice ?', PROFIT_ROLLBACK),
    false,
  );
});
