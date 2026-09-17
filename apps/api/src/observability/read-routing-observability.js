import { randomUUID } from 'node:crypto';
import logger from '../utils/logger.js';
import {
	READ_CAPABILITY,
	inferReadCapabilityFromMessage,
	mapGoalDomainToCapability,
} from './read-capability-inference.js';

export const READ_ROUTING_OUTCOME = Object.freeze({
	READ_V2_SUCCESS: 'READ_V2_SUCCESS',
	READ_V2_ERROR: 'READ_V2_ERROR',
	READ_SAFE_FALLBACK: 'READ_SAFE_FALLBACK',
	READ_LEGACY: 'READ_LEGACY',
	READ_N8N_FALLBACK: 'READ_N8N_FALLBACK',
});

const READ_GOAL_TYPES = new Set(['QUESTION', 'ANALYSIS', 'MIXED']);
const MAX_LATENCY_SAMPLES = 512;

const globalCounters = {
	READ_TOTAL: 0,
	READ_V2_TOTAL: 0,
	READ_LEGACY_TOTAL: 0,
	READ_N8N_FALLBACK_TOTAL: 0,
	READ_V2_ERROR_TOTAL: 0,
	READ_SAFE_FALLBACK_TOTAL: 0,
	ACTION_TO_N8N_FALLBACK: 0,
};

const capabilityCounters = {};
const latencySamples = {};

function ensureCapability(capability) {
	const key = capability || READ_CAPABILITY.UNKNOWN;
	if (!capabilityCounters[key]) {
		capabilityCounters[key] = {
			READ_V2_SUCCESS: 0,
			READ_V2_ERROR: 0,
			READ_SAFE_FALLBACK: 0,
			READ_LEGACY: 0,
			READ_N8N_FALLBACK: 0,
		};
		latencySamples[key] = [];
	}
	return key;
}

function recordLatency(capability, ms) {
	if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return;
	const key = ensureCapability(capability);
	const bucket = latencySamples[key];
	bucket.push(Math.round(ms));
	if (bucket.length > MAX_LATENCY_SAMPLES) bucket.shift();
}

function incrementGlobal(outcome) {
	globalCounters.READ_TOTAL += 1;
	switch (outcome) {
		case READ_ROUTING_OUTCOME.READ_V2_SUCCESS:
		case READ_ROUTING_OUTCOME.READ_V2_ERROR:
			globalCounters.READ_V2_TOTAL += 1;
			if (outcome === READ_ROUTING_OUTCOME.READ_V2_ERROR) {
				globalCounters.READ_V2_ERROR_TOTAL += 1;
			}
			break;
		case READ_ROUTING_OUTCOME.READ_SAFE_FALLBACK:
			globalCounters.READ_SAFE_FALLBACK_TOTAL += 1;
			globalCounters.READ_N8N_FALLBACK_TOTAL += 1;
			break;
		case READ_ROUTING_OUTCOME.READ_LEGACY:
			globalCounters.READ_LEGACY_TOTAL += 1;
			break;
		case READ_ROUTING_OUTCOME.READ_N8N_FALLBACK:
			globalCounters.READ_N8N_FALLBACK_TOTAL += 1;
			break;
		default:
			break;
	}
}

function incrementCapability(capability, outcome) {
	const key = ensureCapability(capability);
	capabilityCounters[key][outcome] = (capabilityCounters[key][outcome] || 0) + 1;
}

export function createReadRoutingCorrelationId() {
	return `rr-${randomUUID().slice(0, 12)}`;
}

export function sanitizeReadRoutingLogPayload(payload) {
	const safe = { ...payload };
	delete safe.message;
	delete safe.password;
	delete safe.token;
	delete safe.authorization;
	delete safe.userId;
	delete safe.clientId;
	delete safe.activityId;
	return safe;
}

/**
 * Record a normalized READ routing event (aggregated metrics + structured log).
 */
export function recordReadRoutingEvent(event) {
	const {
		route = 'READ',
		capability = READ_CAPABILITY.UNKNOWN,
		primaryPath = null,
		outcome,
		fallback = false,
		latencyMs = null,
		correlationId = null,
		goalType = null,
		httpStatus = null,
		errorCode = null,
	} = event || {};

	if (!outcome) return null;

	if (goalType === 'ACTION' && (
		outcome === READ_ROUTING_OUTCOME.READ_N8N_FALLBACK
		|| outcome === READ_ROUTING_OUTCOME.READ_SAFE_FALLBACK
		|| outcome === READ_ROUTING_OUTCOME.READ_LEGACY
	)) {
		globalCounters.ACTION_TO_N8N_FALLBACK += 1;
		logger.warn('ashy_read_routing', sanitizeReadRoutingLogPayload({
			event: 'ACTION_TO_N8N_FALLBACK_BLOCKED',
			route,
			capability,
			correlationId,
		}));
		return null;
	}

	const cap = ensureCapability(capability);
	incrementGlobal(outcome);
	incrementCapability(cap, outcome);
	recordLatency(cap, latencyMs);

	const logPayload = sanitizeReadRoutingLogPayload({
		event: 'ashy_read_routing',
		route,
		capability: cap,
		primaryPath,
		outcome,
		fallback,
		latencyMs: latencyMs != null ? Math.round(latencyMs) : null,
		correlationId,
		goalType,
		httpStatus,
		errorCode,
	});

	logger.info('ashy_read_routing', logPayload);
	return logPayload;
}

export function recordV2AshyChatRouting({
	result,
	latencyMs,
	correlationId,
	httpStatus,
}) {
	const v2 = result?.v2Http || {};
	const goalType = v2.goalType || null;

	if (goalType === 'ACTION') {
		return null;
	}

	if (!READ_GOAL_TYPES.has(goalType)) {
		return null;
	}

	const capability = mapGoalDomainToCapability(v2.goalDomain, v2.goalObjective);
	const success = httpStatus >= 200 && httpStatus < 300
		&& (v2.executionCode === 'SUCCESS' || v2.responseStatus === 'SUCCESS' || Boolean(result?.reply));

	const outcome = success
		? READ_ROUTING_OUTCOME.READ_V2_SUCCESS
		: READ_ROUTING_OUTCOME.READ_V2_ERROR;

	return recordReadRoutingEvent({
		route: 'READ',
		capability,
		primaryPath: result?.primaryPath || 'V2_HTTP',
		outcome,
		fallback: false,
		latencyMs,
		correlationId,
		goalType,
		httpStatus,
		errorCode: success ? null : (v2.executionCode || v2.responseStatus || 'ERROR'),
	});
}

export function recordLegacyN8nChatRouting({
	message,
	latencyMs,
	correlationId,
	httpStatus,
	fallbackMode = null,
	goalType = null,
}) {
	if (goalType === 'ACTION') {
		return null;
	}

	const capability = inferReadCapabilityFromMessage(message);
	const isSafeFallback = fallbackMode === 'safe-fallback';
	const outcome = isSafeFallback
		? READ_ROUTING_OUTCOME.READ_SAFE_FALLBACK
		: READ_ROUTING_OUTCOME.READ_LEGACY;

	return recordReadRoutingEvent({
		route: 'READ',
		capability,
		primaryPath: isSafeFallback ? 'V2_THEN_N8N' : 'N8N',
		outcome,
		fallback: isSafeFallback,
		latencyMs,
		correlationId,
		httpStatus,
	});
}

function computeLatencyStats(samples) {
	if (!samples?.length) {
		return { count: 0, min: null, p50: null, p95: null, max: null };
	}
	const sorted = [...samples].sort((a, b) => a - b);
	return {
		count: sorted.length,
		min: sorted[0],
		p50: sorted[Math.floor(sorted.length / 2)],
		p95: sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1],
		max: sorted[sorted.length - 1],
	};
}

export function getReadRoutingMetricsSnapshot() {
	const byCapability = {};
	for (const [cap, counters] of Object.entries(capabilityCounters)) {
		byCapability[cap] = {
			...counters,
			latency: computeLatencyStats(latencySamples[cap]),
		};
	}
	return {
		global: { ...globalCounters },
		byCapability,
		timestamp: new Date().toISOString(),
	};
}

export function resetReadRoutingMetricsForTests() {
	for (const key of Object.keys(globalCounters)) {
		globalCounters[key] = 0;
	}
	for (const key of Object.keys(capabilityCounters)) {
		delete capabilityCounters[key];
	}
	for (const key of Object.keys(latencySamples)) {
		delete latencySamples[key];
	}
}

export function getReadRoutingMetricsForTests() {
	return getReadRoutingMetricsSnapshot();
}
