/**
 * Phase 5.8-F4-B2-C — request_hash canonicalization (unit).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
	buildCanonicalOperationPayload,
	canonicalJsonStringify,
	computeRequestHash,
	generateOperationId,
} from '../src/lib/agent-operation-idempotency.js';

describe('F4-B2-C — agent-operation-idempotency', () => {
	const CLIENT = '22222222-2222-4222-8222-222222222222';

	test('hash stable for same logical expense', () => {
		const pending = { tool: 'create_expense', label: ' transport ', amount: 500 };
		const h1 = computeRequestHash(CLIENT, pending);
		const h2 = computeRequestHash(CLIENT, { tool: 'create_expense', label: 'transport', amount: 500 });
		assert.equal(h1, h2);
		assert.match(h1, /^[a-f0-9]{64}$/);
	});

	test('hash differs when business payload differs', () => {
		const base = { tool: 'create_expense', label: 'transport', amount: 500 };
		const h1 = computeRequestHash(CLIENT, base);
		const h2 = computeRequestHash(CLIENT, { ...base, amount: 501 });
		assert.notEqual(h1, h2);
	});

	test('hash includes client_id scope', () => {
		const pending = { tool: 'create_expense', label: 'transport', amount: 500 };
		const h1 = computeRequestHash(CLIENT, pending);
		const h2 = computeRequestHash('33333333-3333-4333-8333-333333333333', pending);
		assert.notEqual(h1, h2);
	});

	test('canonical JSON sorts keys', () => {
		const payload = buildCanonicalOperationPayload(CLIENT, {
			tool: 'create_sale',
			product: 'poulets',
			quantity: 2,
			unitPrice: 10,
			amountPaid: 20,
		});
		const json = canonicalJsonStringify(payload);
		assert.ok(json.indexOf('"amountPaid"') < json.indexOf('"clientId"'));
	});

	test('operation_id is backend UUID', () => {
		const id = generateOperationId();
		assert.match(id, /^[0-9a-f-]{36}$/i);
	});

	test('hash ignores property order', () => {
		const pendingA = { tool: 'create_expense', label: 'loyer', amount: 100 };
		const pendingB = { amount: 100, tool: 'create_expense', label: 'loyer' };
		assert.equal(
			computeRequestHash(CLIENT, pendingA),
			computeRequestHash(CLIENT, pendingB),
		);
	});

	test('hash trims label whitespace', () => {
		const h1 = computeRequestHash(CLIENT, { tool: 'create_expense', label: ' loyer ', amount: 100 });
		const h2 = computeRequestHash(CLIENT, { tool: 'create_expense', label: 'loyer', amount: 100 });
		assert.equal(h1, h2);
	});

	test('hash differs for decimal vs integer when values differ', () => {
		const h1 = computeRequestHash(CLIENT, { tool: 'create_expense', label: 'x', amount: 100 });
		const h2 = computeRequestHash(CLIENT, { tool: 'create_expense', label: 'x', amount: 100.5 });
		assert.notEqual(h1, h2);
	});
});
