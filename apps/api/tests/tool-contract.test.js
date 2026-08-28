import assert from 'node:assert/strict';
import test from 'node:test';

import { TOOL_METADATA } from '../src/tools/definitions.js';
import { assertWriteToolPolicy, WRITE_TOOL_POLICY } from '../src/tools/write-policy.js';
import { errorToolResult, normalizeToolResult, successToolResult, assertToolResultShape } from '../src/utils/tool-result.js';

test('ToolResult success shape includes error null', () => {
	const result = successToolResult('get_sales', { summary: { count: 1 } });
	assert.equal(result.success, true);
	assert.equal(result.error, null);
	assert.ok(result.data);
});

test('ToolResult error shape includes data null', () => {
	const result = errorToolResult('get_sales', 'SUPABASE_ERROR', 'db down');
	assert.equal(result.success, false);
	assert.equal(result.data, null);
	assert.equal(result.error.code, 'SUPABASE_ERROR');
});

test('write tools declare confirmation and Supabase truth policy', () => {
	assert.equal(WRITE_TOOL_POLICY.requiresSupabaseSuccess, true);
	for (const name of ['create_sale', 'create_expense', 'update_sale', 'adjust_stock']) {
		assert.equal(assertWriteToolPolicy(TOOL_METADATA[name]), true);
	}
});

test('normalizeToolResult enforces consistent success/error shape', () => {
	const success = assertToolResultShape(successToolResult('get_sales', { summary: { count: 1 } }));
	assert.equal(success.error, null);
	assert.ok(success.data);

	const failure = assertToolResultShape(normalizeToolResult({
		success: false,
		tool: 'get_sales',
		meta: {},
	}));
	assert.equal(failure.data, null);
	assert.ok(failure.error);
});
