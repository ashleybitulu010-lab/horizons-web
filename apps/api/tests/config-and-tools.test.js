import assert from 'node:assert/strict';
import test from 'node:test';

import { getEnv, isSupabaseConfigured, publicConfigSnapshot } from '../src/config/env.js';
import { TOOL_NAMES } from '../src/tools/definitions.js';
import { getToolDefinition, listToolDefinitions } from '../src/tools/registry.js';
import { assertAshyContract } from '../src/agent/contract.js';
import { createAshyAgent } from '../src/agent/index.js';

test('publicConfigSnapshot never exposes secret fields', () => {
	const snapshot = publicConfigSnapshot(getEnv());
	assert.equal(snapshot.supabaseServiceRoleKey, undefined);
	assert.equal(snapshot.ashInternalHealthKey, undefined);
	assert.equal(snapshot.n8nChatWebhook, undefined);
	assert.equal(typeof snapshot.supabaseConfigured, 'boolean');
});

test('tool registry lists all planned tools with get_sales implemented', () => {
	const tools = listToolDefinitions();
	assert.equal(tools.length, TOOL_NAMES.length);
	for (const name of TOOL_NAMES) {
		const def = getToolDefinition(name);
		assert.ok(def);
		assert.equal(def.sourceOfTruth, 'supabase');
		assert.ok(def.inputSchema);
		if (name === 'get_sales' || name === 'get_expenses' || name === 'get_stock' || name === 'get_debts' || name === 'get_products') {
			assert.equal(def.implemented, true);
			assert.equal(def.mutatesData, false);
		} else if (name.startsWith('create_') || name.startsWith('update_') || name === 'adjust_stock') {
			assert.equal(def.implemented, false);
			assert.equal(def.mutatesData, true);
			assert.equal(def.requiresConfirmation, true);
		} else {
			assert.equal(def.implemented, false);
		}
	}
});

test('Ashy contract enforces Supabase truth rules', () => {
	const contract = assertAshyContract();
	assert.equal(contract.supabaseIsBusinessTruth, true);
	assert.equal(contract.conversationMemoryIsNotFinancialTruth, true);
	assert.equal(contract.writesRequireSupabaseConfirmation, true);
});

test('Ashy agent exposes implemented tools', () => {
	const agent = createAshyAgent();
	assert.equal(typeof agent.run, 'function');
	assert.equal(agent.contract.supabaseIsBusinessTruth, true);
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
		ledgerTimezone: 'Africa/Kinshasa',
	}), false);

	assert.equal(isSupabaseConfigured({
		nodeEnv: 'test',
		port: 3001,
		corsOrigin: null,
		supabaseUrl: 'https://example.supabase.co',
		supabaseServiceRoleKey: 'secret-key',
		ashInternalHealthKey: '',
		n8nChatWebhook: '',
		ledgerTimezone: 'Africa/Kinshasa',
	}), true);
});
