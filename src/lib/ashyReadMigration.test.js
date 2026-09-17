import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAshyReadSalesMigrated,
  isMigratedReadIntent,
  isSalesReadIntent,
  READ_CAPABILITY,
} from './ashyReadMigration.js';
import { CHAT_ROUTE, resolveChatRoute } from './chatRouter.js';

const FLAG_OFF = { VITE_ASHY_READ_CHAT: 'false', VITE_ASHY_WRITE_CHAT: 'false' };
const SALES_ROLLBACK = { ...FLAG_OFF, VITE_ASHY_READ_SALES: 'false' };

test('isAshyReadSalesMigrated defaults ON for H12.1 rollback via false', () => {
  assert.equal(isAshyReadSalesMigrated({}), true);
  assert.equal(isAshyReadSalesMigrated({ VITE_ASHY_READ_SALES: 'true' }), true);
  assert.equal(isAshyReadSalesMigrated({ VITE_ASHY_READ_SALES: 'false' }), false);
});

test('isSalesReadIntent detects sales reads not writes', () => {
  assert.equal(isSalesReadIntent('Quelles sont mes ventes ?'), true);
  assert.equal(isSalesReadIntent('Combien ai-je vendu ce mois-ci ?'), true);
  assert.equal(isSalesReadIntent('Et mes ventes ?'), true);
  assert.equal(isSalesReadIntent("J'ai vendu 10 pains à 2 $"), false);
  assert.equal(isSalesReadIntent('Quelles sont mes dépenses ?'), false);
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

test('H12.1 sales rollback restores n8n for sales read', () => {
  assert.equal(
    resolveChatRoute('Quelles sont mes ventes ?', { env: SALES_ROLLBACK }),
    CHAT_ROUTE.N8N,
  );
});

test('isMigratedReadIntent only matches SALES capability', () => {
  assert.equal(isMigratedReadIntent(READ_CAPABILITY.SALES, 'Quelles sont mes ventes ?'), true);
  assert.equal(isMigratedReadIntent(READ_CAPABILITY.SALES, 'Quelles sont mes dépenses ?'), false);
});
