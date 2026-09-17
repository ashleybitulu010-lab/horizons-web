import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAshyReadExpensesMigrated,
  isAshyReadSalesMigrated,
  isExpensesReadIntent,
  isMigratedReadIntent,
  isSalesReadIntent,
  READ_CAPABILITY,
} from './ashyReadMigration.js';
import { CHAT_ROUTE, resolveChatRoute } from './chatRouter.js';

const FLAG_OFF = { VITE_ASHY_READ_CHAT: 'false', VITE_ASHY_WRITE_CHAT: 'false' };
const SALES_ROLLBACK = { ...FLAG_OFF, VITE_ASHY_READ_SALES: 'false' };
const EXPENSES_ON = { ...FLAG_OFF, VITE_ASHY_READ_EXPENSES: 'true' };
const EXPENSES_ROLLBACK = { ...FLAG_OFF, VITE_ASHY_READ_EXPENSES: 'false' };
const H122_ON = { ...FLAG_OFF, VITE_ASHY_READ_EXPENSES: 'true' };

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

test('H12.2 regression — stock/products/debts not migrated', () => {
  assert.equal(resolveChatRoute('Quel est mon stock ?', { env: H122_ON }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Liste mes produits', { env: H122_ON }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Qui me doit de l\'argent ?', { env: H122_ON }), CHAT_ROUTE.N8N);
  assert.equal(resolveChatRoute('Génère mon bilan PDF', { env: H122_ON }), CHAT_ROUTE.N8N);
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
});
