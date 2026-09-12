/**
 * Phase 5.8-P0-STAGING — Real Supabase validation.
 * Requires explicit opt-in (see tests/agent-session-p0-staging.README.md).
 * Never logs secrets, tokens, or full pendingWrite payloads.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

import { setForceRegexResolverForTests } from '../src/agent/intent-resolver/index.js';
import {
	clearConversationSessionsForTests,
	getConversationState,
	mergeConversationState,
	saveConversationState,
} from '../src/agent/conversation-state.js';
import {
	getAgentSessionState,
	resetAgentSessionReaderForTests,
} from '../src/services/agent-session-reader.js';
import {
	CONSUME_PENDING_STATUS,
	consumeAgentPending,
	mirrorSessionsAtomic,
	resetAgentSessionServiceImplForTests,
} from '../src/services/agent-session-service.js';
import {
	createAshyAgent,
	PENDING_PERSISTENCE_FAILED_REPLY,
} from '../src/agent/index.js';
import {
	mirrorAgentSessionState,
	resetAgentSessionWriterForTests,
} from '../src/services/agent-session-writer.js';
import {
	getAgentSessionParityMetricsForTests,
	resetAgentSessionParityForTests,
	setIsParityEnabledForTests,
} from '../src/services/agent-session-parity.js';
import {
	setCreateExpenseImplForTests,
	resetCreateExpenseImplForTests,
} from '../src/services/expenses-write-service.js';
import {
	evaluateStagingHarnessGate,
	stagingHarnessSkipMessage,
} from './helpers/agent-session-p0-staging-guard.js';

const STAGING_GATE = evaluateStagingHarnessGate();
const STAGING_HARNESS_ENABLED = STAGING_GATE.allowed;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TAG = `p0staging-${Date.now()}`;

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let admin = null;
/** @type {string[]} */
const clientIds = [];
/** @type {string[]} */
const authUserIds = [];

function skipStaging(t) {
	if (!STAGING_HARNESS_ENABLED) {
		t.skip(stagingHarnessSkipMessage(STAGING_GATE));
	}
}

function emptyDraft(topic = 'staging') {
	return {
		topic,
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
		updatedAt: new Date().toISOString(),
	};
}

function testPending(label = 'staging-test') {
	return {
		pendingWrite: {
			tool: 'create_expense',
			label,
			amount: 1,
		},
		consumeToken: `tok-${TAG}-${randomUUID()}`,
	};
}

async function createAuthUser(label) {
	const email = `${TAG}-${label}-${randomUUID()}@p0staging.ashledger.test`;
	const password = `P0staging!${randomUUID().slice(0, 8)}`;
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
	});
	if (error) throw error;
	authUserIds.push(data.user.id);
	return data.user.id;
}

async function createClientRow(authUserId, label) {
	const userId = `${TAG}-${label}-${randomUUID()}`;
	const { data, error } = await admin
		.from('clients')
		.insert({
			user_id: userId,
			nom_client: `P0 Staging ${label}`,
			auth_user_id: authUserId,
			thread_id: '[]',
		})
		.select('id')
		.single();
	if (error) throw error;
	clientIds.push(data.id);
	return data.id;
}

function userForClient(clientId, label) {
	return {
		id: `pb-${label}`,
		clientId,
		businessUserId: `${TAG}-${label}`,
	};
}

async function readDbPair(clientId) {
	const { data, error } = await admin
		.from('agent_sessions')
		.select('state_type, payload, state_version, awaiting, intention')
		.eq('client_id', clientId);
	if (error) throw error;
	const draft = data?.find((r) => r.state_type === 'draft') ?? null;
	const pending = data?.find((r) => r.state_type === 'pending') ?? null;
	return { draft, pending };
}

async function cleanupClientSessions(clientId) {
	await admin.from('agent_sessions').delete().eq('client_id', clientId);
}

describe('Phase 5.8-P0-STAGING — prerequisites', { skip: !STAGING_HARNESS_ENABLED }, () => {
	before(async () => {
		admin = createClient(SUPABASE_URL, SERVICE_KEY, {
			auth: { autoRefreshToken: false, persistSession: false },
			global: { fetch },
			realtime: { transport: ws },
		});
	});

	after(async () => {
		if (!admin) return;
		for (const id of clientIds) {
			await admin.from('agent_sessions').delete().eq('client_id', id);
			await admin.from('clients').delete().eq('id', id);
		}
		for (const uid of authUserIds) {
			await admin.auth.admin.deleteUser(uid);
		}
		resetAgentSessionServiceImplForTests();
		resetAgentSessionWriterForTests();
		resetAgentSessionReaderForTests();
		resetAgentSessionParityForTests();
		resetCreateExpenseImplForTests();
		clearConversationSessionsForTests();
	});

	test('schema — state_version column readable', async (t) => {
		skipStaging(t);
		const authUserId = await createAuthUser('schema');
		const clientId = await createClientRow(authUserId, 'schema');
		const user = userForClient(clientId, 'schema');

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: null,
		});

		const { draft } = await readDbPair(clientId);
		assert.ok(draft);
		assert.equal(typeof draft.state_version, 'number');
		assert.ok(draft.state_version >= 1);

		await cleanupClientSessions(clientId);
	});

	test('RPC — mirror_agent_sessions_atomic present', async (t) => {
		skipStaging(t);
		const authUserId = await createAuthUser('rpc-mirror');
		const clientId = await createClientRow(authUserId, 'rpc-mirror');
		const user = userForClient(clientId, 'rpc-mirror');

		const result = await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft('rpc-check'),
			pendingPayload: null,
		});

		assert.ok(result?.draftVersion);
		await cleanupClientSessions(clientId);
	});

	test('RPC — consume_agent_pending present', async (t) => {
		skipStaging(t);
		const authUserId = await createAuthUser('rpc-consume');
		const clientId = await createClientRow(authUserId, 'rpc-consume');
		const user = userForClient(clientId, 'rpc-consume');
		const token = `tok-${randomUUID()}`;

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: { ...testPending(), consumeToken: token },
			pendingAwaiting: 'confirm',
			pendingIntention: 'create_expense',
		});

		const consumed = await consumeAgentPending({ user, consumeToken: token });
		assert.equal(consumed.status, CONSUME_PENDING_STATUS.CONSUMED);

		await cleanupClientSessions(clientId);
	});
});

describe('Phase 5.8-P0-STAGING — P0-1 atomic mirror', { skip: !STAGING_HARNESS_ENABLED }, () => {
	before(async () => {
		if (!admin) {
			admin = createClient(SUPABASE_URL, SERVICE_KEY, {
				auth: { autoRefreshToken: false, persistSession: false },
				global: { fetch },
				realtime: { transport: ws },
			});
		}
	});

	test('A empty → no rows', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('p01a'), 'p01a');
		const user = userForClient(clientId, 'p01a');
		const pair = await readDbPair(clientId);
		assert.equal(pair.draft, null);
		assert.equal(pair.pending, null);
		await cleanupClientSessions(clientId);
		void user;
	});

	test('B draft only', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('p01b'), 'p01b');
		const user = userForClient(clientId, 'p01b');

		await mirrorSessionsAtomic({ user, draftPayload: emptyDraft('draft-only'), pendingPayload: null });
		const { draft, pending } = await readDbPair(clientId);
		assert.ok(draft);
		assert.equal(pending, null);
		assert.equal(draft.payload.topic, 'draft-only');
		await cleanupClientSessions(clientId);
	});

	test('C draft + pending atomic', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('p01c'), 'p01c');
		const user = userForClient(clientId, 'p01c');
		const pendingPayload = testPending('fuel');

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft('with-pending'),
			pendingPayload,
			pendingAwaiting: 'confirm',
			pendingIntention: 'create_expense',
		});

		const { draft, pending } = await readDbPair(clientId);
		assert.ok(draft);
		assert.ok(pending);
		assert.equal(pending.payload.pendingWrite.label, 'fuel');
		assert.equal(pending.awaiting, 'confirm');
		await cleanupClientSessions(clientId);
	});

	test('D replace pending A → B', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('p01d'), 'p01d');
		const user = userForClient(clientId, 'p01d');

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: testPending('A'),
			pendingAwaiting: 'confirm',
		});
		const vA = (await readDbPair(clientId)).pending.state_version;

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: testPending('B'),
			pendingAwaiting: 'confirm',
		});
		const { pending } = await readDbPair(clientId);
		assert.equal(pending.payload.pendingWrite.label, 'B');
		assert.ok(pending.state_version > vA);
		await cleanupClientSessions(clientId);
	});

	test('E clear pending with version', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('p01e'), 'p01e');
		const user = userForClient(clientId, 'p01e');

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: testPending(),
			pendingAwaiting: 'confirm',
		});
		const version = (await readDbPair(clientId)).pending.state_version;

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft('cleared'),
			pendingPayload: null,
			clearPendingVersion: version,
		});

		const { draft, pending } = await readDbPair(clientId);
		assert.ok(draft);
		assert.equal(pending, null);
		await cleanupClientSessions(clientId);
	});

	test('F clear + new pending', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('p01f'), 'p01f');
		const user = userForClient(clientId, 'p01f');

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: testPending('old'),
			pendingAwaiting: 'confirm',
		});
		const vOld = (await readDbPair(clientId)).pending.state_version;

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: null,
			clearPendingVersion: vOld,
		});

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft('new'),
			pendingPayload: testPending('new'),
			pendingAwaiting: 'confirm',
		});

		const { pending } = await readDbPair(clientId);
		assert.equal(pending.payload.pendingWrite.label, 'new');
		await cleanupClientSessions(clientId);
	});
});

describe('Phase 5.8-P0-STAGING — P0-2 concurrency', { skip: !STAGING_HARNESS_ENABLED }, () => {
	test('CAS A — save B then stale clear A: B remains', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('p02a'), 'p02a');
		const user = userForClient(clientId, 'p02a');

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: testPending('A'),
			pendingAwaiting: 'confirm',
		});
		const versionA = (await readDbPair(clientId)).pending.state_version;

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: testPending('B'),
			pendingAwaiting: 'confirm',
		});

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: null,
			clearPendingVersion: versionA,
		});

		const { pending } = await readDbPair(clientId);
		assert.ok(pending);
		assert.equal(pending.payload.pendingWrite.label, 'B');
		await cleanupClientSessions(clientId);
	});

	test('CAS C — stale version clear deletes 0 rows', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('p02c'), 'p02c');
		const user = userForClient(clientId, 'p02c');

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: testPending('A'),
			pendingAwaiting: 'confirm',
		});
		const versionA = (await readDbPair(clientId)).pending.state_version;
		assert.equal(versionA, 1);

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: testPending('B'),
			pendingAwaiting: 'confirm',
		});
		const versionB = (await readDbPair(clientId)).pending.state_version;
		assert.ok(versionB > versionA);

		const result = await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: null,
			clearPendingVersion: versionA,
		});

		assert.equal(result.pendingCleared, 0);
		const { pending } = await readDbPair(clientId);
		assert.ok(pending);
		assert.equal(pending.payload.pendingWrite.label, 'B');
		assert.equal(pending.state_version, versionB);
		await cleanupClientSessions(clientId);
	});

	test('CAS D — consume then clear already gone is safe', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('p02d'), 'p02d');
		const user = userForClient(clientId, 'p02d');
		const token = `tok-${randomUUID()}`;

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: { ...testPending(), consumeToken: token },
			pendingAwaiting: 'confirm',
		});
		const version = (await readDbPair(clientId)).pending.state_version;

		await consumeAgentPending({ user, consumeToken: token });
		const second = await consumeAgentPending({ user, expectedVersion: version });
		assert.equal(second.status, CONSUME_PENDING_STATUS.ALREADY_CONSUMED);

		const result = await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: null,
			clearPendingVersion: version,
		});
		assert.equal(result.pendingCleared, 0);
		await cleanupClientSessions(clientId);
	});
});

describe('Phase 5.8-P0-STAGING — P0-3 idempotence', { skip: !STAGING_HARNESS_ENABLED }, () => {
	test('double consume — second ALREADY_CONSUMED', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('p03a'), 'p03a');
		const user = userForClient(clientId, 'p03a');
		const token = `tok-${randomUUID()}`;

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: { ...testPending(), consumeToken: token },
			pendingAwaiting: 'confirm',
		});
		const version = (await readDbPair(clientId)).pending.state_version;

		const first = await consumeAgentPending({ user, consumeToken: token, expectedVersion: version });
		const second = await consumeAgentPending({ user, consumeToken: token, expectedVersion: version });

		assert.equal(first.status, CONSUME_PENDING_STATUS.CONSUMED);
		assert.equal(second.status, CONSUME_PENDING_STATUS.ALREADY_CONSUMED);
		assert.equal((await readDbPair(clientId)).pending, null);
		await cleanupClientSessions(clientId);
	});

	test('concurrent consume — exactly one CONSUMED', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('p03b'), 'p03b');
		const user = userForClient(clientId, 'p03b');
		const token = `tok-${randomUUID()}`;

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft(),
			pendingPayload: { ...testPending(), consumeToken: token },
			pendingAwaiting: 'confirm',
		});
		const version = (await readDbPair(clientId)).pending.state_version;

		const results = await Promise.all([
			consumeAgentPending({ user, consumeToken: token, expectedVersion: version }),
			consumeAgentPending({ user, consumeToken: token, expectedVersion: version }),
		]);

		const consumed = results.filter((r) => r.status === CONSUME_PENDING_STATUS.CONSUMED);
		assert.equal(consumed.length, 1);
		assert.equal((await readDbPair(clientId)).pending, null);
		await cleanupClientSessions(clientId);
	});
});

describe('Phase 5.8-P0-STAGING — multi-tenant', { skip: !STAGING_HARNESS_ENABLED }, () => {
	test('consume A does not affect B', async (t) => {
		skipStaging(t);
		const clientA = await createClientRow(await createAuthUser('mt-a'), 'mt-a');
		const clientB = await createClientRow(await createAuthUser('mt-b'), 'mt-b');
		const userA = userForClient(clientA, 'mt-a');
		const userB = userForClient(clientB, 'mt-b');
		const tokenA = `tok-${randomUUID()}`;
		const tokenB = `tok-${randomUUID()}`;

		await mirrorSessionsAtomic({
			user: userA,
			draftPayload: emptyDraft('A'),
			pendingPayload: { ...testPending('tenant-a'), consumeToken: tokenA },
			pendingAwaiting: 'confirm',
		});
		await mirrorSessionsAtomic({
			user: userB,
			draftPayload: emptyDraft('B'),
			pendingPayload: { ...testPending('tenant-b'), consumeToken: tokenB },
			pendingAwaiting: 'confirm',
		});

		await consumeAgentPending({ user: userA, consumeToken: tokenA });

		const pairB = await readDbPair(clientB);
		assert.ok(pairB.pending);
		assert.equal(pairB.pending.payload.pendingWrite.label, 'tenant-b');

		await cleanupClientSessions(clientA);
		await cleanupClientSessions(clientB);
	});
});

describe('Phase 5.8-P0-STAGING — restart / reader', { skip: !STAGING_HARNESS_ENABLED }, () => {
	test('reader finds pending after DB-only reload', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('restart'), 'restart');
		const user = userForClient(clientId, 'restart');
		const sessionId = 'sess-restart-staging';
		const token = `tok-${randomUUID()}`;

		await mirrorSessionsAtomic({
			user,
			draftPayload: emptyDraft('persist'),
			pendingPayload: { ...testPending('persist'), consumeToken: token },
			pendingAwaiting: 'confirm',
			pendingIntention: 'create_expense',
		});

		clearConversationSessionsForTests();
		resetAgentSessionReaderForTests();

		const { state, source } = await getAgentSessionState({ user, sessionId });
		assert.equal(source, 'agent_sessions');
		assert.equal(state.pendingWrite?.label, 'persist');
		assert.ok(state.pendingSessionVersion >= 1);
		assert.equal(state.pendingConsumeToken, token);

		await cleanupClientSessions(clientId);
	});
});

describe('Phase 5.8-P0-STAGING — orchestrator', { skip: !STAGING_HARNESS_ENABLED }, () => {
	test('parallel confirmations → one write only (mock expense)', async (t) => {
		skipStaging(t);
		process.env.AGENT_SESSION_MIRROR_AWAIT = 'true';
		setForceRegexResolverForTests(true);
		setIsParityEnabledForTests(true);

		const clientId = await createClientRow(await createAuthUser('orch'), 'orch');
		const user = userForClient(clientId, 'orch');
		const sessionId = 'sess-orch-staging';
		const token = `tok-${randomUUID()}`;

		await mirrorSessionsAtomic({
			user,
			draftPayload: {
				...emptyDraft('expenses'),
				intent: 'create_expense',
			},
			pendingPayload: {
				pendingWrite: { tool: 'create_expense', label: 'staging-fuel', amount: 1 },
				consumeToken: token,
			},
			pendingAwaiting: 'confirm',
			pendingIntention: 'create_expense',
		});

		const version = (await readDbPair(clientId)).pending.state_version;
		saveConversationState(user.id, sessionId, mergeConversationState(
			getConversationState(user.id, sessionId),
			{
				topic: 'expenses',
				intent: 'create_expense',
				pendingWrite: { tool: 'create_expense', label: 'staging-fuel', amount: 1 },
				pendingConsumeToken: token,
				pendingSessionVersion: version,
			},
		));

		let writeCount = 0;
		setCreateExpenseImplForTests(async () => {
			writeCount += 1;
			return { expenseId: 'exp-staging', label: 'staging-fuel', amount: 1 };
		});

		const agent = createAshyAgent();
		await Promise.all([
			agent.run({ message: 'oui', user, sessionId }),
			agent.run({ message: 'oui', user, sessionId }),
		]);

		assert.equal(writeCount, 1);
		const metrics = getAgentSessionParityMetricsForTests();
		assert.equal(JSON.stringify(metrics).includes('staging-fuel'), false);

		await cleanupClientSessions(clientId);
	});
});

describe('Phase 5.8-F2-STAGING — pending DB required', { skip: !STAGING_HARNESS_ENABLED }, () => {
	const savedPendingDbRequired = process.env.AGENT_SESSION_PENDING_DB_REQUIRED;
	const savedMirrorAwait = process.env.AGENT_SESSION_MIRROR_AWAIT;

	before(() => {
		process.env.AGENT_SESSION_PENDING_DB_REQUIRED = 'true';
		process.env.AGENT_SESSION_MIRROR_AWAIT = 'true';
		setForceRegexResolverForTests(true);
	});

	after(() => {
		if (savedPendingDbRequired === undefined) {
			delete process.env.AGENT_SESSION_PENDING_DB_REQUIRED;
		} else {
			process.env.AGENT_SESSION_PENDING_DB_REQUIRED = savedPendingDbRequired;
		}
		if (savedMirrorAwait === undefined) {
			delete process.env.AGENT_SESSION_MIRROR_AWAIT;
		} else {
			process.env.AGENT_SESSION_MIRROR_AWAIT = savedMirrorAwait;
		}
	});

	test('A — DB pending créé après message dépense', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('f2-a'), 'f2-a');
		const user = userForClient(clientId, 'f2-a');
		const sessionId = 'sess-f2-staging-a';

		const agent = createAshyAgent();
		const result = await agent.run({
			message: "J'ai dépensé 500 $ pour le transport",
			user,
			sessionId,
		});

		assert.notEqual(result.reply, PENDING_PERSISTENCE_FAILED_REPLY);
		assert.equal(result.toolResults[0]?.error?.code, 'NEEDS_CONFIRMATION');

		const pair = await readDbPair(clientId);
		assert.ok(pair.pending);
		assert.equal(pair.pending.payload.pendingWrite.tool, 'create_expense');
		assert.equal(pair.pending.payload.pendingWrite.label, 'transport');
		assert.equal(pair.pending.payload.pendingWrite.amount, 500);
		assert.equal(pair.pending.awaiting, 'confirm');

		await cleanupClientSessions(clientId);
	});

	test('B — DB pending visible au tour suivant via reader', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('f2-b'), 'f2-b');
		const user = userForClient(clientId, 'f2-b');
		const sessionId = 'sess-f2-staging-b';

		const agent = createAshyAgent();
		await agent.run({
			message: "J'ai dépensé 300 $ pour le carburant",
			user,
			sessionId,
		});

		clearConversationSessionsForTests();
		resetAgentSessionReaderForTests();

		const { state, source } = await getAgentSessionState({ user, sessionId });
		assert.equal(source, 'agent_sessions');
		assert.equal(state.pendingWrite?.label, 'carburant');
		assert.equal(state.pendingWrite?.amount, 300);
		assert.ok(state.pendingSessionVersion >= 1);
		assert.ok(state.pendingConsumeToken);

		await cleanupClientSessions(clientId);
	});

	test('C — DB pending absent après consume', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('f2-c'), 'f2-c');
		const user = userForClient(clientId, 'f2-c');
		const sessionId = 'sess-f2-staging-c';

		const agent = createAshyAgent();
		await agent.run({
			message: "J'ai dépensé 200 $ pour le loyer",
			user,
			sessionId,
		});

		const pairBefore = await readDbPair(clientId);
		assert.ok(pairBefore.pending);
		const token = pairBefore.pending.payload.consumeToken;
		const version = pairBefore.pending.state_version;

		const consume = await consumeAgentPending({
			user,
			consumeToken: token,
			expectedVersion: version,
		});
		assert.equal(consume.status, CONSUME_PENDING_STATUS.CONSUMED);

		const pairAfter = await readDbPair(clientId);
		assert.equal(pairAfter.pending, null);

		await cleanupClientSessions(clientId);
	});

	test('D — confirmation complète avec pending DB obligatoire', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('f2-d'), 'f2-d');
		const user = userForClient(clientId, 'f2-d');
		const sessionId = 'sess-f2-staging-d';

		let writeCount = 0;
		setCreateExpenseImplForTests(async () => {
			writeCount += 1;
			return { expenseId: 'exp-f2-staging', label: 'transport', amount: 500 };
		});

		const agent = createAshyAgent();
		const draft = await agent.run({
			message: "J'ai dépensé 500 $ pour le transport",
			user,
			sessionId,
		});
		assert.notEqual(draft.reply, PENDING_PERSISTENCE_FAILED_REPLY);
		assert.equal(draft.toolResults[0]?.error?.code, 'NEEDS_CONFIRMATION');
		assert.ok((await readDbPair(clientId)).pending);

		const confirm = await agent.run({
			message: 'oui',
			user,
			sessionId,
		});
		assert.equal(confirm.toolResults[0]?.success, true);
		assert.equal(writeCount, 1);
		assert.equal((await readDbPair(clientId)).pending, null);

		await cleanupClientSessions(clientId);
	});
});

describe('Phase 5.8-F3-STAGING — DB-first writer', { skip: !STAGING_HARNESS_ENABLED }, () => {
	const savedWriteDbFirst = process.env.AGENT_SESSION_WRITE_DB_FIRST;
	const savedRamFallback = process.env.AGENT_SESSION_RAM_FALLBACK;
	const savedPendingDbRequired = process.env.AGENT_SESSION_PENDING_DB_REQUIRED;
	const savedMirrorAwait = process.env.AGENT_SESSION_MIRROR_AWAIT;

	before(() => {
		process.env.AGENT_SESSION_WRITE_DB_FIRST = 'true';
		process.env.AGENT_SESSION_RAM_FALLBACK = 'true';
		process.env.AGENT_SESSION_PENDING_DB_REQUIRED = 'true';
		process.env.AGENT_SESSION_MIRROR_AWAIT = 'true';
		setForceRegexResolverForTests(true);
	});

	after(() => {
		if (savedWriteDbFirst === undefined) {
			delete process.env.AGENT_SESSION_WRITE_DB_FIRST;
		} else {
			process.env.AGENT_SESSION_WRITE_DB_FIRST = savedWriteDbFirst;
		}
		if (savedRamFallback === undefined) {
			delete process.env.AGENT_SESSION_RAM_FALLBACK;
		} else {
			process.env.AGENT_SESSION_RAM_FALLBACK = savedRamFallback;
		}
		if (savedPendingDbRequired === undefined) {
			delete process.env.AGENT_SESSION_PENDING_DB_REQUIRED;
		} else {
			process.env.AGENT_SESSION_PENDING_DB_REQUIRED = savedPendingDbRequired;
		}
		if (savedMirrorAwait === undefined) {
			delete process.env.AGENT_SESSION_MIRROR_AWAIT;
		} else {
			process.env.AGENT_SESSION_MIRROR_AWAIT = savedMirrorAwait;
		}
	});

	test('pending DB-first — DB row before confirmation', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('f3-pending'), 'f3-pending');
		const user = userForClient(clientId, 'f3-pending');
		const sessionId = 'sess-f3-staging-pending';

		const agent = createAshyAgent();
		const result = await agent.run({
			message: "J'ai dépensé 500 $ pour le transport",
			user,
			sessionId,
		});

		assert.notEqual(result.reply, PENDING_PERSISTENCE_FAILED_REPLY);
		assert.equal(result.toolResults[0]?.error?.code, 'NEEDS_CONFIRMATION');
		const pair = await readDbPair(clientId);
		assert.ok(pair.pending);
		assert.ok(pair.draft);

		await cleanupClientSessions(clientId);
	});

	test('restart — reader DB after RAM reset', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('f3-restart'), 'f3-restart');
		const user = userForClient(clientId, 'f3-restart');
		const sessionId = 'sess-f3-staging-restart';

		const agent = createAshyAgent();
		await agent.run({
			message: "J'ai dépensé 200 $ pour le loyer",
			user,
			sessionId,
		});

		clearConversationSessionsForTests();
		resetAgentSessionReaderForTests();

		const { state, source } = await getAgentSessionState({ user, sessionId });
		assert.equal(source, 'agent_sessions');
		assert.equal(state.pendingWrite?.label, 'loyer');

		await cleanupClientSessions(clientId);
	});

	test('clarification DB-first', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('f3-clarify'), 'f3-clarify');
		const user = userForClient(clientId, 'f3-clarify');
		const sessionId = 'sess-f3-staging-clarify';

		const agent = createAshyAgent();
		const result = await agent.run({
			message: "j'ai dépensé pour le transport",
			user,
			sessionId,
		});

		assert.match(result.reply, /montant/i);
		const pair = await readDbPair(clientId);
		assert.ok(pair.draft);

		await cleanupClientSessions(clientId);
	});

	test('confirmation complète DB-first', async (t) => {
		skipStaging(t);
		const clientId = await createClientRow(await createAuthUser('f3-confirm'), 'f3-confirm');
		const user = userForClient(clientId, 'f3-confirm');
		const sessionId = 'sess-f3-staging-confirm';

		let writeCount = 0;
		setCreateExpenseImplForTests(async () => {
			writeCount += 1;
			return { expenseId: 'exp-f3-staging', label: 'transport', amount: 500 };
		});

		const agent = createAshyAgent();
		await agent.run({
			message: "J'ai dépensé 500 $ pour le transport",
			user,
			sessionId,
		});
		const confirm = await agent.run({ message: 'oui', user, sessionId });

		assert.equal(confirm.toolResults[0]?.success, true);
		assert.equal(writeCount, 1);
		assert.equal((await readDbPair(clientId)).pending, null);

		await cleanupClientSessions(clientId);
	});
});

describe('Phase 5.8-P0-STAGING — skip marker', () => {
	test('staging blocked when safety gate is not satisfied', (t) => {
		if (!STAGING_HARNESS_ENABLED) {
			t.skip(stagingHarnessSkipMessage(STAGING_GATE));
		}
	});

	test('staging gate diagnostics contain no secrets', () => {
		const json = JSON.stringify(STAGING_GATE.diagnostics);
		if (SERVICE_KEY) {
			assert.equal(json.includes(SERVICE_KEY), false);
		}
		assert.ok(json.includes('serviceRoleKey'));
	});
});
