import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildN8nChatClientResponse,
	buildN8nChatPayload,
	buildN8nSaveMessagePayload,
	extractN8nChatReply,
	truncateProxyLogBody,
} from '../src/utils/n8n-proxy.js';

test('buildN8nChatPayload forwards metadata and overrides identity from req.user', () => {
	const req = {
		user: {
			id: 'pb-1',
			businessUserId: 'biz-1',
			airtableId: 'air-1',
			email: 'a@test.com',
			firstName: 'Ada',
			lastName: 'Lovelace',
		},
		body: {
			message: '  hello  ',
			sessionId: 'sess-x',
			recent_messages: [{ role: 'user', content: 'prev' }],
			currency: 'USD',
			pdf_base64: 'abc',
			filename: 'facture.pdf',
			type: 'pdf',
			userId: 'evil-other',
			clientId: 'evil-client',
		},
	};

	const payload = buildN8nChatPayload(req);
	assert.equal(payload.message, 'hello');
	assert.equal(payload.chatInput, 'hello');
	assert.equal(payload.sessionId, 'sess-x');
	assert.equal(payload.userId, 'biz-1');
	assert.equal(payload.pbUserId, 'pb-1');
	assert.equal(payload.airtableId, 'air-1');
	assert.deepEqual(payload.recent_messages, [{ role: 'user', content: 'prev' }]);
	assert.equal(payload.currency, 'USD');
	assert.equal(payload.pdf_base64, 'abc');
	assert.equal(payload.filename, 'facture.pdf');
	assert.equal(payload.type, 'pdf');
	assert.equal(payload.userId, 'biz-1');
	assert.equal('clientId' in payload, false);
});

test('buildN8nChatClientResponse passthrough PDF fields', () => {
	const payload = buildN8nChatClientResponse({
		reply: 'ignored',
		pdf_base64: 'JVBERi0x',
		filename: 'bilan.pdf',
		type: 'pdf',
		mime_type: 'application/pdf',
	}, 'Voici votre bilan');

	assert.equal(payload.reply, 'Voici votre bilan');
	assert.equal(payload.pdf_base64, 'JVBERi0x');
	assert.equal(payload.filename, 'bilan.pdf');
	assert.equal(payload.type, 'pdf');
	assert.equal(payload.mime_type, 'application/pdf');
});

test('buildN8nChatClientResponse keeps text-only replies unchanged', () => {
	const payload = buildN8nChatClientResponse(null, 'Bonjour');
	assert.deepEqual(payload, { reply: 'Bonjour' });
});

test('extractN8nChatReply reads common n8n fields', () => {
	assert.equal(extractN8nChatReply({ output: 'a' }), 'a');
	assert.equal(extractN8nChatReply({ reply: 'b' }), 'b');
	assert.equal(extractN8nChatReply([{ output: 'c' }]), 'c');
});

test('truncateProxyLogBody omits pdf payloads from logs', () => {
	const raw = JSON.stringify({ reply: 'ok', pdf_base64: 'x'.repeat(1000) });
	const truncated = truncateProxyLogBody(raw);
	assert.match(truncated, /pdf_base64 omitted/);
});

test('buildN8nSaveMessagePayload forwards currency metadata', () => {
	const req = {
		user: {
			id: 'pb-1',
			businessUserId: 'biz-1',
			email: 'a@test.com',
			firstName: 'Ada',
			lastName: 'Lovelace',
		},
		body: {
			role: 'user',
			content: 'hello',
			currency: 'USD',
			ledgerCurrency: 'USD',
			userId: 'evil',
		},
	};

	const payload = buildN8nSaveMessagePayload(req);
	assert.equal(payload.userId, 'biz-1');
	assert.equal(payload.role, 'user');
	assert.equal(payload.content, 'hello');
	assert.equal(payload.currency, 'USD');
	assert.equal(payload.ledgerCurrency, 'USD');
});
