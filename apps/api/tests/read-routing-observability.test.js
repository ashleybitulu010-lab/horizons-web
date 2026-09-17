import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
	READ_CAPABILITY,
	inferReadCapabilityFromMessage,
	mapGoalDomainToCapability,
} from '../src/observability/read-capability-inference.js';
import {
	READ_ROUTING_OUTCOME,
	createReadRoutingCorrelationId,
	getReadRoutingMetricsForTests,
	recordLegacyN8nChatRouting,
	recordReadRoutingEvent,
	recordV2AshyChatRouting,
	resetReadRoutingMetricsForTests,
	sanitizeReadRoutingLogPayload,
} from '../src/observability/read-routing-observability.js';

afterEach(() => {
	resetReadRoutingMetricsForTests();
});

describe('read routing observability', () => {
	test('V2 READ success increments metrics once', () => {
		recordV2AshyChatRouting({
			result: {
				reply: '3 ventes',
				primaryPath: 'V2_HTTP',
				v2Http: {
					goalType: 'QUESTION',
					goalDomain: 'SALES',
					executionCode: 'SUCCESS',
				},
			},
			latencyMs: 1200,
			correlationId: 'rr-test-success',
			httpStatus: 200,
		});

		const snap = getReadRoutingMetricsForTests();
		assert.equal(snap.global.READ_TOTAL, 1);
		assert.equal(snap.global.READ_V2_TOTAL, 1);
		assert.equal(snap.global.READ_V2_ERROR_TOTAL, 0);
		assert.equal(snap.byCapability.SALES.READ_V2_SUCCESS, 1);
		assert.equal(snap.byCapability.SALES.latency.count, 1);
		assert.equal(snap.byCapability.SALES.latency.p50, 1200);
	});

	test('V2 READ error increments error counter', () => {
		recordV2AshyChatRouting({
			result: {
				v2Http: {
					goalType: 'QUESTION',
					goalDomain: 'EXPENSES',
					executionCode: 'ERROR',
				},
			},
			latencyMs: 800,
			correlationId: 'rr-test-error',
			httpStatus: 500,
		});

		const snap = getReadRoutingMetricsForTests();
		assert.equal(snap.global.READ_V2_ERROR_TOTAL, 1);
		assert.equal(snap.byCapability.EXPENSES.READ_V2_ERROR, 1);
	});

	test('safe fallback records READ_SAFE_FALLBACK and n8n totals', () => {
		recordLegacyN8nChatRouting({
			message: 'Quelles sont mes ventes ?',
			latencyMs: 900,
			correlationId: 'rr-test-fallback',
			httpStatus: 200,
			fallbackMode: 'safe-fallback',
		});

		const snap = getReadRoutingMetricsForTests();
		assert.equal(snap.global.READ_SAFE_FALLBACK_TOTAL, 1);
		assert.equal(snap.global.READ_N8N_FALLBACK_TOTAL, 1);
		assert.equal(snap.byCapability.SALES.READ_SAFE_FALLBACK, 1);
	});

	test('legacy n8n route records READ_LEGACY', () => {
		recordLegacyN8nChatRouting({
			message: 'Quelles sont mes dépenses ?',
			latencyMs: 1100,
			correlationId: 'rr-test-legacy',
			httpStatus: 200,
		});

		const snap = getReadRoutingMetricsForTests();
		assert.equal(snap.global.READ_LEGACY_TOTAL, 1);
		assert.equal(snap.byCapability.EXPENSES.READ_LEGACY, 1);
	});

	test('capability tagging from goal domain and message inference', () => {
		assert.equal(mapGoalDomainToCapability('SALES'), READ_CAPABILITY.SALES);
		assert.equal(inferReadCapabilityFromMessage('Quel est mon stock ?'), READ_CAPABILITY.STOCK);
		assert.equal(inferReadCapabilityFromMessage('J\'ai vendu 2 poulets'), READ_CAPABILITY.UNKNOWN);
	});

	test('latency stats require multiple samples for percentiles', () => {
		recordReadRoutingEvent({
			capability: READ_CAPABILITY.PRODUCTS,
			outcome: READ_ROUTING_OUTCOME.READ_LEGACY,
			latencyMs: 100,
		});
		recordReadRoutingEvent({
			capability: READ_CAPABILITY.PRODUCTS,
			outcome: READ_ROUTING_OUTCOME.READ_LEGACY,
			latencyMs: 300,
		});
		recordReadRoutingEvent({
			capability: READ_CAPABILITY.PRODUCTS,
			outcome: READ_ROUTING_OUTCOME.READ_LEGACY,
			latencyMs: 500,
		});

		const stats = getReadRoutingMetricsForTests().byCapability.PRODUCTS.latency;
		assert.equal(stats.count, 3);
		assert.equal(stats.min, 100);
		assert.equal(stats.p50, 300);
		assert.equal(stats.max, 500);
	});

	test('sanitize removes sensitive fields from log payload', () => {
		const safe = sanitizeReadRoutingLogPayload({
			route: 'READ',
			capability: 'SALES',
			message: 'secret user message',
			password: 'p',
			token: 'Bearer xyz',
			userId: 'uuid-user',
			clientId: 'uuid-client',
			activityId: 'uuid-activity',
			correlationId: 'rr-safe',
		});

		assert.equal(safe.message, undefined);
		assert.equal(safe.password, undefined);
		assert.equal(safe.token, undefined);
		assert.equal(safe.userId, undefined);
		assert.equal(safe.correlationId, 'rr-safe');
	});

	test('ACTION cannot fallback to n8n — blocked and counted', () => {
		const result = recordReadRoutingEvent({
			capability: READ_CAPABILITY.SALES,
			outcome: READ_ROUTING_OUTCOME.READ_SAFE_FALLBACK,
			goalType: 'ACTION',
			correlationId: 'rr-action-block',
		});

		assert.equal(result, null);
		const snap = getReadRoutingMetricsForTests();
		assert.equal(snap.global.ACTION_TO_N8N_FALLBACK, 1);
		assert.equal(snap.global.READ_TOTAL, 0);
	});

	test('V2 handler skips ACTION goal type', () => {
		const result = recordV2AshyChatRouting({
			result: {
				v2Http: { goalType: 'ACTION', goalDomain: 'SALES' },
			},
			latencyMs: 500,
			correlationId: 'rr-action-skip',
			httpStatus: 200,
		});

		assert.equal(result, null);
		assert.equal(getReadRoutingMetricsForTests().global.READ_TOTAL, 0);
	});

	test('correlation id is opaque and non-sensitive', () => {
		const id = createReadRoutingCorrelationId();
		assert.match(id, /^rr-[0-9a-f-]{12,36}$/i);
		assert.doesNotMatch(id, /Bearer|password|service_role/i);
	});
});
