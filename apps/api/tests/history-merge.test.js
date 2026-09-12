import assert from 'node:assert/strict';
import test from 'node:test';

import {
	compareHistoryMessages,
	isLikelyCrossSourceDuplicate,
	mergeHistorySources,
	normalizeHistoryContent,
	sortHistoryMessages,
} from '../src/utils/history-merge.js';

test('normalizeHistoryContent trims and collapses whitespace', () => {
	assert.equal(normalizeHistoryContent('  hello   world  '), 'hello world');
});

test('isLikelyCrossSourceDuplicate requires nearby timestamps', () => {
	const supabase = {
		id: 'sb-1',
		role: 'user',
		content: 'Bonjour',
		timestamp: '2026-08-01T10:00:00.000Z',
	};
	const closeN8n = {
		id: 'n8n-1',
		role: 'user',
		content: 'Bonjour',
		timestamp: '2026-08-01T10:01:00.000Z',
	};
	const farN8n = {
		id: 'n8n-2',
		role: 'user',
		content: 'Bonjour',
		timestamp: '2026-08-05T10:00:00.000Z',
	};

	assert.equal(isLikelyCrossSourceDuplicate(supabase, closeN8n), true);
	assert.equal(isLikelyCrossSourceDuplicate(supabase, farN8n), false);
});

test('isLikelyCrossSourceDuplicate does not dedupe when timestamps are missing', () => {
	const supabase = { id: 'sb-1', role: 'user', content: 'Bonjour', timestamp: null };
	const n8n = { id: 'n8n-1', role: 'user', content: 'Bonjour', timestamp: '2026-08-01T10:00:00.000Z' };
	assert.equal(isLikelyCrossSourceDuplicate(supabase, n8n), false);
});

test('merge keeps repeated identical messages on different days', () => {
	const supabase = [
		{ id: 'sb-1', role: 'user', content: 'Bonjour', timestamp: '2026-08-01T10:00:00.000Z' },
		{ id: 'sb-2', role: 'user', content: 'Bonjour', timestamp: '2026-08-05T10:00:00.000Z' },
	];
	const n8n = [
		{ id: 'n8n-1', role: 'user', content: 'Bonjour', timestamp: '2026-08-01T10:00:30.000Z' },
		{ id: 'n8n-2', role: 'user', content: 'Bonjour', timestamp: '2026-08-05T10:00:30.000Z' },
	];

	const merged = mergeHistorySources(supabase, n8n);
	assert.equal(merged.length, 2);
	assert.deepEqual(merged.map((m) => m.id), ['sb-1', 'sb-2']);
});

test('merge sorts by timestamp chronologically', () => {
	const supabase = [
		{ id: 'sb-2', role: 'assistant', content: 'B', timestamp: '2026-08-02T10:00:00.000Z' },
	];
	const n8n = [
		{ id: 'n8n-1', role: 'user', content: 'A', timestamp: '2026-08-01T10:00:00.000Z' },
	];

	const merged = mergeHistorySources(supabase, n8n);
	assert.deepEqual(merged.map((m) => m.id), ['n8n-1', 'sb-2']);
});

test('sortHistoryMessages places undated messages after dated ones', () => {
	const messages = [
		{ id: 'b', role: 'user', content: 'no date', timestamp: null },
		{ id: 'a', role: 'user', content: 'dated', timestamp: '2026-08-01T10:00:00.000Z' },
	];
	const sorted = sortHistoryMessages(messages);
	assert.deepEqual(sorted.map((m) => m.id), ['a', 'b']);
});

test('compareHistoryMessages is deterministic for equal timestamps', () => {
	const a = { id: 'a', role: 'user', content: 'x', timestamp: '2026-08-01T10:00:00.000Z' };
	const b = { id: 'b', role: 'assistant', content: 'y', timestamp: '2026-08-01T10:00:00.000Z' };
	assert.ok(compareHistoryMessages(a, b) < 0);
});
