import {
	getConversationStore,
	resetConversationStoreForTests,
} from './conversation-store.js';
import { generateOperationId } from '../lib/agent-operation-idempotency.js';
import { createPendingConsumeToken } from '../services/agent-session-service.js';
import {
	incrementWriteRamSuccessForTests,
	mirrorAgentSessionState,
	shouldAwaitAgentSessionMirror,
	isPendingDbRequired,
	isWriteDbFirst,
	verifyPendingInDb,
	recordPendingPersistenceOutcome,
	recordWriterRamCacheSuccess,
	recordWriterRamCacheFailure,
	PENDING_PERSISTENCE_OUTCOMES,
	MIRROR_OUTCOMES,
	executeDbFirstConversationPersist,
} from '../services/agent-session-writer.js';
import logger from '../utils/logger.js';

export const ALLOWED_STATE_KEYS = Object.freeze([
	'topic',
	'intent',
	'filters',
	'references',
	'lastTool',
	'lastAction',
	'updatedAt',
	'pendingWrite',
	'pendingSessionVersion',
	'pendingConsumeToken',
	'pendingOperationId',
]);

export const ALLOWED_REFERENCE_KEYS = Object.freeze([
	'lastPeriod',
	'previousPeriod',
	'lastProduct',
	'lastEntity',
]);

export const ALLOWED_FILTER_KEYS = Object.freeze([
	'period',
	'periods',
	'product',
	'category',
	'lowStockOnly',
	'status',
	'debtor',
	'quantity',
	'unitPrice',
	'amountPaid',
	'confirmed',
	'label',
	'amount',
]);


const FORBIDDEN_FINANCIAL_KEYS = Object.freeze([
	'totalRevenue',
	'totalCollected',
	'total',
	'amount',
	'montant',
	'balance',
	'solde',
	'stock',
	'count',
	'sales',
	'expenses',
	'debts',
	'summary',
]);

export function createEmptyConversationState() {
	return {
		topic: null,
		intent: null,
		filters: {},
		references: {
			lastPeriod: null,
			previousPeriod: null,
			lastProduct: null,
			lastEntity: null,
		},
		lastTool: null,
		lastAction: null,
		updatedAt: null,
		pendingWrite: null,
		pendingSessionVersion: null,
		pendingConsumeToken: null,
		pendingOperationId: null,
	};
}

export function getConversationState(userId, sessionId, activityId = null) {
	const store = getConversationStore();
	const stored = store.getConversationState(userId, sessionId, activityId)
		|| (activityId ? store.getConversationState(userId, sessionId, null) : null);
	return stored || createEmptyConversationState();
}

export function saveConversationState(userId, sessionId, state, activityId = null) {
	assertConversationStateIsContextOnly(state);
	getConversationStore().saveConversationState(userId, sessionId, {
		...state,
		updatedAt: new Date().toISOString(),
	}, activityId);
}

function cacheConversationStateToRam(userId, sessionId, state, activityId = null) {
	try {
		saveConversationState(userId, sessionId, state, activityId);
		incrementWriteRamSuccessForTests();
		recordWriterRamCacheSuccess();
		return true;
	} catch (error) {
		recordWriterRamCacheFailure();
		logger.warn('[agent-session-writer]', {
			event: 'agent_session_write',
			mode: 'db_first',
			outcome: 'ram_cache_failure',
			userId,
			sessionId,
			hasPendingWrite: state?.pendingWrite != null,
			errorCode: error?.code || 'RAM_CACHE_FAILED',
		});
		return false;
	}
}

async function persistConversationStateLegacy({ user, sessionId, state, requirePendingDb = false }) {
	saveConversationState(user.id, sessionId, state, user.activeActivityId);
	incrementWriteRamSuccessForTests();

	const mustSecurePending = requirePendingDb
		&& isPendingDbRequired()
		&& state?.pendingWrite != null;

	if (mustSecurePending) {
		const mirrorResult = await mirrorAgentSessionState({ user, sessionId, state });
		if (mirrorResult?.outcome !== MIRROR_OUTCOMES.SUCCESS) {
			recordPendingPersistenceOutcome(PENDING_PERSISTENCE_OUTCOMES.BLOCKED_CONFIRMATION);
			logger.warn('[agent-session-writer]', {
				event: 'pending_persistence',
				outcome: PENDING_PERSISTENCE_OUTCOMES.BLOCKED_CONFIRMATION,
				userId: user?.id,
				sessionId,
				hasPendingWrite: true,
				errorCode: mirrorResult?.errorCode || 'MIRROR_NOT_SUCCESS',
			});
			return {
				ok: false,
				reason: mirrorResult?.errorCode || 'MIRROR_NOT_SUCCESS',
				blockedConfirmation: true,
			};
		}

		const verification = await verifyPendingInDb({
			user,
			consumeToken: state.pendingConsumeToken,
			pendingWrite: state.pendingWrite,
		});

		if (!verification.ok) {
			recordPendingPersistenceOutcome(PENDING_PERSISTENCE_OUTCOMES.BLOCKED_CONFIRMATION);
			logger.warn('[agent-session-writer]', {
				event: 'pending_persistence',
				outcome: PENDING_PERSISTENCE_OUTCOMES.BLOCKED_CONFIRMATION,
				userId: user?.id,
				sessionId,
				hasPendingWrite: true,
				errorCode: verification.reason,
			});
			return {
				ok: false,
				reason: verification.reason,
				blockedConfirmation: true,
			};
		}

		recordPendingPersistenceOutcome(PENDING_PERSISTENCE_OUTCOMES.SUCCESS);
		const syncedState = {
			...state,
			pendingSessionVersion: verification.pendingVersion ?? state.pendingSessionVersion ?? null,
			pendingConsumeToken: verification.consumeToken ?? state.pendingConsumeToken ?? null,
			pendingOperationId: verification.operationId ?? state.pendingOperationId ?? null,
		};
		saveConversationState(user.id, sessionId, syncedState, user.activeActivityId);

		return {
			ok: true,
			outcome: 'SUCCESS',
			dbSuccess: true,
			pendingVersion: verification.pendingVersion ?? null,
			consumeToken: verification.consumeToken ?? null,
		};
	}

	const mirrorTask = mirrorAgentSessionState({ user, sessionId, state }).catch((error) => {
		logger.warn('[agent-session-writer]', {
			event: 'agent_session_mirror',
			outcome: 'unhandled_failure',
			userId: user?.id,
			sessionId,
			hasPendingWrite: state?.pendingWrite != null,
			errorCode: error?.code || 'UNHANDLED',
		});
	});

	if (shouldAwaitAgentSessionMirror()) {
		await mirrorTask;
	}

	return { ok: true, outcome: 'SUCCESS', dbSuccess: false };
}

async function persistConversationStateDbFirst({ user, sessionId, state, requirePendingDb = false }) {
	const dbResult = await executeDbFirstConversationPersist({
		user,
		sessionId,
		state,
		requirePendingDb,
	});

	if (dbResult.blockedConfirmation || dbResult.outcome === 'DB_DIVERGENCE') {
		return dbResult;
	}

	if (dbResult.dbSuccess && dbResult.syncedState) {
		cacheConversationStateToRam(user.id, sessionId, dbResult.syncedState, user.activeActivityId);
		return dbResult;
	}

	if (dbResult.ramFallback && dbResult.syncedState) {
		cacheConversationStateToRam(user.id, sessionId, dbResult.syncedState, user.activeActivityId);
		return dbResult;
	}

	return dbResult;
}

/**
 * Persist ConversationState to RAM (sync) then mirror to agent_sessions (async, FAIL_OPEN).
 * sessionId is used for RAM key and logs only — DB rows are scoped by client_id + activity_id.
 *
 * When AGENT_SESSION_WRITE_DB_FIRST=true: DB write first, then RAM cache.
 * When requirePendingDb + PENDING_DB_REQUIRED (or WRITE_DB_FIRST): verify pending before confirmation.
 */
export async function persistConversationState({ user, sessionId, state, requirePendingDb = false }) {
	if (isWriteDbFirst()) {
		return persistConversationStateDbFirst({ user, sessionId, state, requirePendingDb });
	}
	return persistConversationStateLegacy({ user, sessionId, state, requirePendingDb });
}

export function clearConversationState(userId, sessionId, activityId = null) {
	getConversationStore().clearConversationState(userId, sessionId, activityId);
}

export function clearConversationSessionsForTests() {
	resetConversationStoreForTests();
}

export function mergeConversationState(current, patch) {
	const merged = {
		...current,
		...patch,
		filters: {
			...current.filters,
			...(patch.filters || {}),
		},
		references: {
			...current.references,
			...(patch.references || {}),
		},
		updatedAt: new Date().toISOString(),
	};
	assertConversationStateIsContextOnly(merged);
	if (merged.pendingWrite != null && patch.pendingWrite !== undefined) {
		if (merged.pendingConsumeToken == null) {
			merged.pendingConsumeToken = patch.pendingConsumeToken ?? createPendingConsumeToken();
		}
		if (merged.pendingOperationId == null && patch.pendingOperationId == null) {
			merged.pendingOperationId = generateOperationId();
		}
	}
	if (patch.pendingWrite === null) {
		merged.pendingConsumeToken = null;
		merged.pendingOperationId = null;
	}
	if (patch.pendingSessionVersion !== undefined) {
		merged.pendingSessionVersion = patch.pendingSessionVersion;
	}
	return merged;
}

export function updateReferencesAfterPeriodQuery(
	current,
	period,
	product = null,
	entity = null,
) {
	const references = { ...current.references };

	if (period && references.lastPeriod && references.lastPeriod !== period) {
		references.previousPeriod = references.lastPeriod;
	}
	if (period) {
		references.lastPeriod = period;
	}
	if (product) {
		references.lastProduct = product;
	}
	if (entity) {
		references.lastEntity = entity;
	}

	return references;
}

export function updateReferencesAfterStockQuery(current, product = null) {
	const references = { ...current.references, lastEntity: 'stock' };
	if (product) {
		references.lastProduct = product;
	}
	return references;
}

export function updateReferencesAfterDebtsQuery(current) {
	return {
		...current.references,
		lastEntity: 'debts',
	};
}

export function updateReferencesAfterProductsQuery(current, product = null) {
	const references = {
		...current.references,
		lastEntity: 'products',
	};
	if (product) {
		references.lastProduct = product;
	}
	return references;
}

export function updateReferencesAfterReportQuery(current, period = null) {
	const references = {
		...current.references,
		lastEntity: 'report',
	};
	if (period && references.lastPeriod && references.lastPeriod !== period) {
		references.previousPeriod = references.lastPeriod;
	}
	if (period) {
		references.lastPeriod = period;
	}
	return references;
}

export function applyReferenceUpdateFromPlan(plan, currentState, toolResults) {
	if (!plan?.referenceUpdate || toolResults.length !== 1 || !toolResults[0]?.success) {
		return currentState.references;
	}

	const { type, entity } = plan.referenceUpdate;
	if (type === 'period') {
		return updateReferencesAfterPeriodQuery(
			currentState,
			toolResults[0].meta?.period || null,
			toolResults[0].meta?.product || null,
			entity || null,
		);
	}
	if (type === 'stock') {
		return updateReferencesAfterStockQuery(
			currentState,
			toolResults[0].meta?.product || null,
		);
	}
	if (type === 'debts') {
		return updateReferencesAfterDebtsQuery(currentState);
	}
	if (type === 'products') {
		return updateReferencesAfterProductsQuery(
			currentState,
			toolResults[0].meta?.product || null,
		);
	}
	if (type === 'report') {
		return updateReferencesAfterReportQuery(
			currentState,
			toolResults[0].meta?.period || null,
		);
	}

	return currentState.references;
}


function assertFiltersAreContextOnly(filters, path = 'filters') {
	if (!filters || typeof filters !== 'object') return;

	for (const key of Object.keys(filters)) {
		if (!ALLOWED_FILTER_KEYS.includes(key)) {
			const normalized = key.toLowerCase();
			if (FORBIDDEN_FINANCIAL_KEYS.some((forbidden) => normalized.includes(forbidden.toLowerCase()))) {
				throw new Error(`Conversation state must not store financial truth at ${path}.${key}`);
			}
			throw new Error(`Unexpected conversation filter key: ${key}`);
		}
	}

	for (const [key, value] of Object.entries(filters)) {
		if (value == null) continue;
		if (key === 'periods') {
			if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
				throw new Error(`Conversation filter ${path}.${key} must be a string array`);
			}
			continue;
		}
		if (typeof value === 'boolean' || typeof value === 'string') continue;
		if (key === 'quantity' || key === 'unitPrice' || key === 'amountPaid' || key === 'amount') {
			if (typeof value !== 'number') {
				throw new Error(`Conversation filter ${path}.${key} must be a number`);
			}
			continue;
		}
		if (key === 'label') {
			if (typeof value !== 'string') {
				throw new Error(`Conversation filter ${path}.${key} must be a string`);
			}
			continue;
		}
		throw new Error(`Conversation filter ${path}.${key} must be a primitive context value`);
	}
}

const PENDING_WRITE_FIELDS = Object.freeze({
	create_sale: ['tool', 'product', 'quantity', 'unitPrice', 'amountPaid'],
	create_expense: ['tool', 'label', 'amount'],
});

function assertPendingWriteIsDraftOnly(pendingWrite) {
	if (pendingWrite == null) return;
	if (typeof pendingWrite !== 'object') {
		throw new Error('pendingWrite must be an object or null');
	}
	const allowed = PENDING_WRITE_FIELDS[pendingWrite.tool];
	if (!allowed) {
		throw new Error(`Unsupported pendingWrite tool: ${pendingWrite.tool}`);
	}
	for (const key of Object.keys(pendingWrite)) {
		if (!allowed.includes(key)) {
			throw new Error(`Unexpected pendingWrite key: ${key}`);
		}
	}
}

function assertNoFinancialKeys(value, path) {
	if (value == null || typeof value !== 'object') return;

	for (const [key, nested] of Object.entries(value)) {
		const normalized = key.toLowerCase();
		if (FORBIDDEN_FINANCIAL_KEYS.some((forbidden) => normalized.includes(forbidden.toLowerCase()))) {
			throw new Error(`Conversation state must not store financial truth at ${path}.${key}`);
		}
		if (nested && typeof nested === 'object') {
			assertNoFinancialKeys(nested, `${path}.${key}`);
		}
	}
}

export function assertConversationStateIsContextOnly(state) {
	if (!state || typeof state !== 'object') return;

	for (const key of Object.keys(state)) {
		if (!ALLOWED_STATE_KEYS.includes(key)) {
			throw new Error(`Unexpected conversation state key: ${key}`);
		}
	}

	if (state.references) {
		for (const key of Object.keys(state.references)) {
			if (!ALLOWED_REFERENCE_KEYS.includes(key)) {
				throw new Error(`Unexpected conversation reference key: ${key}`);
			}
		}
	}

	assertFiltersAreContextOnly(state.filters);
	assertNoFinancialKeys(state.references, 'references');
	assertPendingWriteIsDraftOnly(state.pendingWrite);
	if (state.pendingSessionVersion != null && typeof state.pendingSessionVersion !== 'number') {
		throw new Error('pendingSessionVersion must be a number or null');
	}
	if (state.pendingConsumeToken != null && typeof state.pendingConsumeToken !== 'string') {
		throw new Error('pendingConsumeToken must be a string or null');
	}
	if (state.pendingOperationId != null && typeof state.pendingOperationId !== 'string') {
		throw new Error('pendingOperationId must be a string or null');
	}
}

/** @deprecated use updateReferencesAfterPeriodQuery */
export function updateReferencesAfterSalesQuery(current, period, product = null) {
	return updateReferencesAfterPeriodQuery(current, period, product, 'sales');
}
