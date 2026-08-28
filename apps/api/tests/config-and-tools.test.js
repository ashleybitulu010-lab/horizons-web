import assert from 'node:assert/strict';
import test from 'node:test';

import { getEnv, isSupabaseConfigured, publicConfigSnapshot } from '../src/config/env.js';
import { TOOL_NAMES } from '../src/tools/definitions.js';
import { getToolDefinition, listToolDefinitions } from '../src/tools/registry.js';
import { assertAshyContract } from '../src/agent/contract.js';
import { createAshyAgentStub } from '../src/agent/index.js';

test('publicConfigSnapshot never exposes secret fields', () => {
	const snapshot = publicConfigSnapshot(getEnv());
	assert.equal(snapshot.supabaseServiceRoleKey, undefined);
	assert.equal(snapshot.ashInternalHealthKey, undefined);
	assert.equal(snapshot.n8nChatWebhook, undefined);
	assert.equal(typeof snapshot.supabaseConfigured, 'boolean');
});

test('tool registry lists all planned stubs', () => {
	const tools = listToolDefinitions();
	assert.equal(tools.length, TOOL_NAMES.length);
	for (const name of TOOL_NAMES) {
		const def = getToolDefinition(name);
		assert.ok(def);
		assert.equal(def.implemented, false);
	}
});

test('Ashy contract enforces Supabase truth rules', () => {
	const contract = assertAshyContract();
	assert.equal(contract.supabaseIsBusinessTruth, true);
	assert.equal(contract.conversationMemoryIsNotFinancialTruth, true);
	assert.equal(contract.writesRequireSupabaseConfirmation, true);
});

test('Ashy agent stub exposes tools but does not run yet', () => {
	const agent = createAshyAgentStub();
	assert.ok(agent.availableTools.includes('get_sales'));
	assert.rejects(() => agent.run(), /not implemented/i);
});

test('isSupabaseConfigured requires url and service role key', () => {
	assert.equal(isSupabaseConfigured({
		nodeEnv: 'test',
		port: 3001,
		corsOrigin: null,
		supabaseUrl: 'https://example.supabase.co',
		supabaseServiceRoleKey: '',
		ashInternalHealthKey: '',
		n8nChatWebhook: '',
	}), false);

	assert.equal(isSupabaseConfigured({
		nodeEnv: 'test',
		port: 3001,
		corsOrigin: null,
		supabaseUrl: 'https://example.supabase.co',
		supabaseServiceRoleKey: 'secret-key',
		ashInternalHealthKey: '',
		n8nChatWebhook: '',
	}), true);
});
