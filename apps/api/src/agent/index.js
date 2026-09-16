import { assertAshyContract } from './contract.js';
import {
	applyReferenceUpdateFromPlan,
	getConversationState,
	mergeConversationState,
	persistConversationState,
} from './conversation-state.js';
import { getAgentSessionState } from '../services/agent-session-reader.js';
import {
	consumeAgentPending,
	CONSUME_PENDING_STATUS,
} from '../services/agent-session-service.js';
import {
	buildIdempotentRpcParams,
	IDEMPOTENT_REPLAY_ERROR,
	recordIdempotentReplayBlocked,
	resolveTransactionalToolOutcome,
} from '../services/agent-idempotent-replay-service.js';
import {
	buildTransactionalToolError,
	confirmAndCreateExpense,
	confirmAndCreateSale,
	isTransactionalConfirmEnabled,
	TRANSACTIONAL_CONFIRM_STATUS,
} from '../services/agent-transactional-write-service.js';
import { isSupabaseConfigured } from '../config/env.js';
import logger from '../utils/logger.js';
import { conversationPatchFromIntent, resolveIntent } from './intent-resolver.js';
import { formatAshyReply } from './response-formatter.js';
import { planToolExecution } from './tool-planner.js';
import { createToolExecutionContext } from '../tools/context.js';
import { executeTool } from '../tools/registry.js';
import { resolveActivityReference } from '../services/activity-reference-resolver.js';
import { emitShadowGoalDiagnostic } from './intelligence-v2/shadow-mode.js';
import { isIntelligenceV2ShadowEnabled } from './intelligence-v2/config.js';
import { handleV2HttpTurn } from './intelligence-v2/v2-http-handler.js';
import {
	buildV2PrimaryUnhandledAgentResponse,
	resolveCutoverMode,
	resolvePrimaryPath,
	shouldBlockLegacyPassthrough,
	shouldRunShadowObservation,
} from './intelligence-v2/v2-cutover-policy.js';

function conversationSnapshot(user, sessionId) {
	return sanitizeConversationForClient(
		getConversationState(user.id, sessionId, user.activeActivityId),
	);
}

async function resolveScopedUserFromIntent(user, resolved) {
	const reference = resolved?.references?.activityReference;
	if (!reference) {
		return { user, clarification: null };
	}

	const result = await resolveActivityReference(user.clientId, reference);
	if (result.status === 'AMBIGUOUS') {
		return {
			user,
			clarification: result.clarificationQuestion
				|| 'De quelle activité parles-tu ?',
		};
	}
	if (result.status === 'NOT_FOUND') {
		return {
			user,
			clarification: 'Je ne trouve pas cette activité dans ton compte.',
		};
	}
	if (result.status === 'RESOLVED') {
		return {
			user: {
				...user,
				activeActivityId: result.activity.id,
				activeActivity: result.activity,
			},
			clarification: null,
		};
	}
	return { user, clarification: null };
}

function buildPendingWriteFromStep(step) {
	if (!step) return null;
	if (step.tool === 'create_sale') {
		return {
			tool: 'create_sale',
			product: step.input.product,
			quantity: step.input.quantity,
			unitPrice: step.input.unitPrice ?? null,
			amountPaid: step.input.amountPaid ?? null,
		};
	}
	if (step.tool === 'create_expense') {
		return {
			tool: 'create_expense',
			label: step.input.label,
			amount: step.input.amount ?? null,
		};
	}
	return null;
}

function writeConfirmationResponseKind(toolName) {
	if (toolName === 'create_expense') return 'create_expense_confirmation';
	if (toolName === 'create_sale') return 'create_sale_confirmation';
	return 'tool_error';
}

const MULTI_RESULT_KINDS = new Set([
	'compare_sales',
	'compare_expenses',
	'compare_sales_expenses',
]);

function buildIntentDiagnostics(resolved) {
	return {
		resolver: resolved.resolver,
		intent: resolved.intent,
		topic: resolved.topic,
		fallback: Boolean(resolved.resolverMeta?.fallback),
		durationMs: resolved.resolverMeta?.durationMs ?? null,
	};
}

function planHasConfirmedWrite(plan) {
	return plan.steps.some((step) => (
		(step.tool === 'create_sale' || step.tool === 'create_expense')
		&& step.input?.confirmed === true
	));
}

async function tryConsumePendingForConfirmation({ user, previousState }) {
	if (!previousState?.pendingWrite) {
		return { allowed: true, skipped: true };
	}
	if (!isSupabaseConfigured()) {
		return { allowed: true, skipped: true };
	}

	try {
		const result = await consumeAgentPending({
			user,
			expectedVersion: previousState.pendingSessionVersion,
			consumeToken: previousState.pendingConsumeToken,
		});
		if (result.status === CONSUME_PENDING_STATUS.CONSUMED) {
			return { allowed: true, consumed: true };
		}
		return { allowed: false, status: result.status };
	} catch {
		return { allowed: false, status: 'ERROR' };
	}
}

function buildAlreadyConsumedReply(status) {
	if (status === IDEMPOTENT_REPLAY_ERROR.OPERATION_ID_MISSING) {
		return 'Je n\'ai pas pu retrouver l\'identifiant sécurisé de cette opération. Reformule ta demande.';
	}
	if (status === TRANSACTIONAL_CONFIRM_STATUS.REQUEST_HASH_MISMATCH) {
		return 'Cette confirmation ne correspond pas à l\'opération en attente. Reformule ta demande.';
	}
	if (status === CONSUME_PENDING_STATUS.VERSION_MISMATCH
		|| status === TRANSACTIONAL_CONFIRM_STATUS.VERSION_MISMATCH) {
		return 'Une autre confirmation est en cours. Reformule ta demande si besoin.';
	}
	return 'Cette action a déjà été enregistrée.';
}

function confirmedWriteStep(plan) {
	return plan.steps.find((step) => (
		(step.tool === 'create_sale' || step.tool === 'create_expense')
		&& step.input?.confirmed === true
	));
}

async function executeTransactionalConfirmation({
	user,
	sessionId,
	previousState,
	plan,
	nextState,
	resolved,
}) {
	const pending = previousState?.pendingWrite;
	if (!pending) {
		return { handled: false };
	}
	if (!isSupabaseConfigured()) {
		return { handled: false };
	}

	const idempotency = buildIdempotentRpcParams(user, previousState, pending);
	if (!idempotency.ready) {
		recordIdempotentReplayBlocked(idempotency.errorCode);
		return {
			handled: true,
			success: false,
			conflict: true,
			status: idempotency.errorCode || IDEMPOTENT_REPLAY_ERROR.OPERATION_ID_MISSING,
		};
	}

	const params = {
		user,
		expectedVersion: previousState.pendingSessionVersion,
		consumeToken: previousState.pendingConsumeToken,
		operationId: idempotency.operationId,
		requestHash: idempotency.requestHash,
	};

	let rpcResult;
	try {
		if (pending.tool === 'create_expense') {
			rpcResult = await confirmAndCreateExpense(params);
		} else if (pending.tool === 'create_sale') {
			rpcResult = await confirmAndCreateSale(params);
		} else {
			return { handled: false };
		}
	} catch (err) {
		const step = confirmedWriteStep(plan);
		const toolResult = buildTransactionalToolError(step?.tool || pending.tool, err, pending);
		await persistConversationState({
			user,
			sessionId,
			state: mergeConversationState(nextState, {
				pendingWrite: previousState.pendingWrite,
				pendingSessionVersion: previousState.pendingSessionVersion,
				pendingConsumeToken: previousState.pendingConsumeToken,
				pendingOperationId: previousState.pendingOperationId,
				lastTool: step?.tool || pending.tool,
				lastAction: resolved.intent,
			}),
		});
		return {
			handled: true,
			success: false,
			toolResult,
			responseKind: 'tool_error',
		};
	}

	if (rpcResult.status === TRANSACTIONAL_CONFIRM_STATUS.ALREADY_CONSUMED
		|| rpcResult.status === TRANSACTIONAL_CONFIRM_STATUS.VERSION_MISMATCH
		|| rpcResult.status === TRANSACTIONAL_CONFIRM_STATUS.REQUEST_HASH_MISMATCH) {
		return {
			handled: true,
			success: false,
			conflict: true,
			status: rpcResult.status,
		};
	}

	const resolvedOutcome = resolveTransactionalToolOutcome(rpcResult, pending);
	if (!resolvedOutcome.success) {
		const step = confirmedWriteStep(plan);
		const toolResult = buildTransactionalToolError(
			step?.tool || pending.tool,
			{ code: 'SUPABASE_RPC_FAILED', message: 'Transactional confirmation failed' },
			pending,
		);
		return {
			handled: true,
			success: false,
			toolResult,
			responseKind: 'tool_error',
		};
	}

	const step = confirmedWriteStep(plan);
	const { toolResult } = resolvedOutcome;

	const responseKind = step?.tool === 'create_expense'
		? 'create_expense'
		: step?.tool === 'create_sale'
			? 'create_sale'
			: plan.responseKind;

	return {
		handled: true,
		success: true,
		toolResult,
		responseKind,
		statePatch: {
			lastTool: step?.tool || pending.tool,
			lastAction: resolved.intent,
			pendingWrite: null,
			pendingConsumeToken: null,
			pendingSessionVersion: null,
			pendingOperationId: null,
		},
	};
}

export const PENDING_PERSISTENCE_FAILED_REPLY =
	'Je n\'ai pas pu enregistrer cette opération de façon sécurisée. Réessaie.';

export const TRANSACTIONAL_FALLBACK_BLOCKED_REPLY =
	'Cette confirmation doit passer par le canal sécurisé. Réessaie dans un instant.';

export function createAshyAgent() {
	const contract = assertAshyContract();

	return {
		contract,
		async run({ message, user, sessionId = 'default', referenceDate = new Date() }) {
			if (!user?.id) {
				return {
					reply: 'Tu dois être connecté pour que je consulte tes données.',
					conversation: null,
					toolResults: [],
					intentDiagnostics: null,
				};
			}

			const { state: previousState } = await getAgentSessionState({ user, sessionId });
			const cutoverMode = resolveCutoverMode();

			const v2Http = await handleV2HttpTurn({
				message,
				user,
				sessionId,
				previousState,
				referenceDate,
			});

			if (v2Http.handled) {
				const response = {
					...v2Http.agentResponse,
					cutoverMode,
					primaryPath: resolvePrimaryPath(cutoverMode, { v2HttpHandled: true }),
				};
				if (response.v2Http) {
					response.v2Http = {
						...response.v2Http,
						cutoverMode,
						primaryPath: response.primaryPath,
					};
				}
				return response;
			}

			if (shouldBlockLegacyPassthrough(cutoverMode)) {
				return buildV2PrimaryUnhandledAgentResponse({
					cutoverMode,
					message,
					previousState,
					user,
				});
			}

			const resolved = await resolveIntent(message, previousState);

			const { user: scopedUser, clarification: activityClarification } = await resolveScopedUserFromIntent(user, resolved);

			if (isIntelligenceV2ShadowEnabled() && shouldRunShadowObservation(cutoverMode)) {
				emitShadowGoalDiagnostic({
					message,
					conversationContext: previousState,
					legacyResolved: resolved,
					referenceDate,
					executionContext: { user: scopedUser },
					primaryPath: 'LEGACY',
				});
			}

			if (activityClarification) {
				const clarifyState = mergeConversationState(previousState, conversationPatchFromIntent(resolved));
				await persistConversationState({ user: scopedUser, sessionId, state: clarifyState });
				return {
					reply: activityClarification,
					conversation: sanitizeConversationForClient(clarifyState),
					toolResults: [],
					intentDiagnostics: buildIntentDiagnostics(resolved),
				};
			}

			const plan = planToolExecution(resolved);
			const nextState = mergeConversationState(
				previousState,
				conversationPatchFromIntent(resolved),
			);
			const intentDiagnostics = buildIntentDiagnostics(resolved);

			if (resolved.needsClarification) {
				await persistConversationState({ user: scopedUser, sessionId, state: nextState });
				return {
					reply: formatAshyReply('clarification', resolved),
					conversation: sanitizeConversationForClient(nextState),
					toolResults: [],
					intentDiagnostics,
				};
			}

			if (plan.responseKind === 'unimplemented_topic' || plan.responseKind === 'unimplemented_write') {
				await persistConversationState({ user: scopedUser, sessionId, state: nextState });
				return {
					reply: formatAshyReply(plan.responseKind, null, { unimplementedTool: plan.unimplementedTool }),
					conversation: sanitizeConversationForClient(nextState),
					toolResults: [],
					intentDiagnostics,
				};
			}

			if (plan.steps.length === 0) {
				await persistConversationState({ user: scopedUser, sessionId, state: nextState });
				return {
					reply: formatAshyReply('unknown'),
					conversation: sanitizeConversationForClient(nextState),
					toolResults: [],
					intentDiagnostics,
				};
			}

			const context = createToolExecutionContext({ user: scopedUser });
			const toolResults = [];

			if (planHasConfirmedWrite(plan)) {
				if (isTransactionalConfirmEnabled()) {
					const tx = await executeTransactionalConfirmation({
						user: scopedUser,
						sessionId,
						previousState,
						plan,
						nextState,
						resolved,
					});

					if (tx.handled) {
						if (tx.conflict) {
							const preservePending = tx.status === TRANSACTIONAL_CONFIRM_STATUS.REQUEST_HASH_MISMATCH
								|| tx.status === IDEMPOTENT_REPLAY_ERROR.OPERATION_ID_MISSING;
							await persistConversationState({
								user: scopedUser,
								sessionId,
								state: mergeConversationState(nextState, preservePending
									? {
										pendingWrite: previousState.pendingWrite,
										pendingSessionVersion: previousState.pendingSessionVersion,
										pendingConsumeToken: previousState.pendingConsumeToken,
										pendingOperationId: previousState.pendingOperationId,
									}
									: {
										pendingWrite: null,
										pendingSessionVersion: null,
										pendingConsumeToken: null,
										pendingOperationId: null,
									}),
							});
							return {
								reply: buildAlreadyConsumedReply(tx.status),
								conversation: conversationSnapshot(scopedUser, sessionId),
								toolResults: [],
								intentDiagnostics,
							};
						}

						if (!tx.success) {
							return {
								reply: formatAshyReply(tx.responseKind, tx.toolResult),
								conversation: conversationSnapshot(scopedUser, sessionId),
								toolResults: [tx.toolResult].map(sanitizeToolResultForClient),
								intentDiagnostics,
							};
						}

						const toolResult = tx.toolResult;
						toolResults.push(toolResult);

						await persistConversationState({
							user: scopedUser,
							sessionId,
							state: mergeConversationState(nextState, {
								...tx.statePatch,
								filters: resolved.filters || {},
								references: applyReferenceUpdateFromPlan(plan, nextState, toolResults),
							}),
						});

						return {
							reply: formatAshyReply(tx.responseKind, toolResult),
							conversation: conversationSnapshot(scopedUser, sessionId),
							toolResults: toolResults.map(sanitizeToolResultForClient),
							intentDiagnostics,
						};
					}

					logger.warn('transactional_confirm_fallback_blocked', {
						userId: user?.id,
						sessionId,
						hasPendingWrite: Boolean(previousState?.pendingWrite),
						hasOperationId: Boolean(previousState?.pendingOperationId),
						supabaseConfigured: isSupabaseConfigured(),
					});
					return {
						reply: TRANSACTIONAL_FALLBACK_BLOCKED_REPLY,
						conversation: conversationSnapshot(scopedUser, sessionId),
						toolResults: [],
						intentDiagnostics,
					};
				}

				const consume = await tryConsumePendingForConfirmation({ user: scopedUser, previousState });
				if (!consume.allowed) {
					await persistConversationState({
						user: scopedUser,
						sessionId,
						state: mergeConversationState(nextState, {
							pendingWrite: null,
							pendingSessionVersion: null,
							pendingConsumeToken: null,
							pendingOperationId: null,
						}),
					});
					return {
						reply: buildAlreadyConsumedReply(consume.status),
						conversation: conversationSnapshot(scopedUser, sessionId),
						toolResults: [],
						intentDiagnostics,
					};
				}
			}

			for (const step of plan.steps) {
				const result = await executeTool(step.tool, context, step.input, referenceDate);
				toolResults.push(result);

				if (!result.success && result.error?.code === 'NEEDS_CONFIRMATION') {
					const pendingWrite = buildPendingWriteFromStep(step);
					const confirmationState = mergeConversationState(nextState, {
						pendingWrite,
						lastAction: resolved.intent,
					});
					const persistResult = await persistConversationState({
						user: scopedUser,
						sessionId,
						state: confirmationState,
						requirePendingDb: true,
					});

					if (persistResult.blockedConfirmation) {
						await persistConversationState({
							user: scopedUser,
							sessionId,
							state: mergeConversationState(confirmationState, {
								pendingWrite: null,
								pendingSessionVersion: null,
								pendingConsumeToken: null,
								pendingOperationId: null,
							}),
						});
						return {
							reply: PENDING_PERSISTENCE_FAILED_REPLY,
							conversation: conversationSnapshot(scopedUser, sessionId),
							toolResults: toolResults.map(sanitizeToolResultForClient),
							intentDiagnostics,
						};
					}

					return {
						reply: formatAshyReply(writeConfirmationResponseKind(step.tool), result),
						conversation: conversationSnapshot(scopedUser, sessionId),
						toolResults: toolResults.map(sanitizeToolResultForClient),
						intentDiagnostics,
					};
				}

				if (!result.success) {
					await persistConversationState({
						user: scopedUser,
						sessionId,
						state: mergeConversationState(nextState, {
							lastTool: step.tool,
							lastAction: resolved.intent,
						}),
					});
					return {
						reply: formatAshyReply('tool_error', result),
						conversation: conversationSnapshot(scopedUser, sessionId),
						toolResults: toolResults.map(sanitizeToolResultForClient),
						intentDiagnostics,
					};
				}
			}

			const statePatch = {
				lastTool: plan.steps[plan.steps.length - 1]?.tool || null,
				lastAction: resolved.intent,
				filters: resolved.filters || {},
				references: applyReferenceUpdateFromPlan(plan, nextState, toolResults),
				pendingWrite: null,
				pendingConsumeToken: null,
				pendingOperationId: null,
			};

			await persistConversationState({
				user: scopedUser,
				sessionId,
				state: mergeConversationState(nextState, statePatch),
			});

			const payload = MULTI_RESULT_KINDS.has(plan.responseKind)
				? toolResults
				: toolResults[0];

			return {
				reply: formatAshyReply(plan.responseKind, payload),
				conversation: conversationSnapshot(scopedUser, sessionId),
				toolResults: toolResults.map(sanitizeToolResultForClient),
				intentDiagnostics,
			};
		},
	};
}

export function sanitizeConversationForClient(state) {
	return {
		topic: state.topic,
		intent: state.intent,
		filters: state.filters,
		references: state.references,
		lastTool: state.lastTool,
		lastAction: state.lastAction,
		updatedAt: state.updatedAt,
	};
}

export function sanitizeToolResultForClient(result) {
	return {
		success: result.success,
		tool: result.tool,
		meta: result.meta,
		error: result.error || null,
		summary: result.success ? result.data?.summary || null : null,
	};
}

/** @deprecated use createAshyAgent */
export function createAshyAgentStub() {
	return createAshyAgent();
}
