import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import http from 'node:http';

import history from '../src/routes/history.js';
import { getThread, saveMessage } from '../src/routes/thread.js';
import { requireAuth, rejectForeignIdentity, assertParamUserIsSelf } from '../src/middleware/auth.js';
import { errorMiddleware } from '../src/middleware/error.js';
import {
	resetTokenVerifierForTests,
	setTokenVerifierForTests,
} from '../src/services/pocketbase-auth.js';

const USER_A = {
	id: 'pb_user_a',
	email: 'a@example.com',
	firstName: 'Alice',
	lastName: 'A',
	airtableId: 'recA123',
};

const USER_B = {
	id: 'pb_user_b',
	email: 'b@example.com',
	firstName: 'Bob',
	lastName: 'B',
	airtableId: 'recB456',
};

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = {
	N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL,
	N8N_SAVE_MESSAGE_WEBHOOK: process.env.N8N_SAVE_MESSAGE_WEBHOOK,
	N8N_GET_THREAD_WEBHOOK: process.env.N8N_GET_THREAD_WEBHOOK,
};

function isN8nTestUrl(url) {
	const value = String(url);
	return value.includes('n8n.test');
}

function installN8nFetchMock(handler) {
	global.fetch = async (url, init) => {
		if (isN8nTestUrl(url)) {
			return handler(url, init);
		}
		return ORIGINAL_FETCH(url, init);
	};
}

function listen(app) {
	return new Promise((resolve, reject) => {
		const server = http.createServer(app);
		server.listen(0, '127.0.0.1', () => resolve(server));
		server.on('error', reject);
	});
}

function close(server) {
	return new Promise((resolve, reject) => {
		server.close((err) => (err ? reject(err) : resolve()));
	});
}

async function fetchJson(baseUrl, path, options = {}) {
	const res = await fetch(`${baseUrl}${path}`, options);
	const body = await res.json().catch(() => ({}));
	return { status: res.status, body };
}

function mountThreadApp() {
	const app = express();
	app.use(express.json());
	app.post('/history', requireAuth, rejectForeignIdentity, history);
	app.get('/thread/:userId', requireAuth, assertParamUserIsSelf('userId'), getThread);
	app.post('/thread/message', requireAuth, rejectForeignIdentity, saveMessage);
	app.use(errorMiddleware);
	return app;
}

test.beforeEach(() => {
	process.env.N8N_WEBHOOK_URL = 'https://n8n.test/hook/main';
	delete process.env.N8N_SAVE_MESSAGE_WEBHOOK;
	delete process.env.N8N_GET_THREAD_WEBHOOK;

	setTokenVerifierForTests(async (token) => {
		if (token === 'valid-token-a') return USER_A;
		if (token === 'valid-token-b') return USER_B;
		return null;
	});
});

test.afterEach(() => {
	resetTokenVerifierForTests();
	global.fetch = ORIGINAL_FETCH;
	process.env.N8N_WEBHOOK_URL = ORIGINAL_ENV.N8N_WEBHOOK_URL;
	process.env.N8N_SAVE_MESSAGE_WEBHOOK = ORIGINAL_ENV.N8N_SAVE_MESSAGE_WEBHOOK;
	process.env.N8N_GET_THREAD_WEBHOOK = ORIGINAL_ENV.N8N_GET_THREAD_WEBHOOK;
});

test('POST /history without auth returns 401', async () => {
	const app = mountThreadApp();
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/history', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ user_id: USER_A.airtableId }),
		});
		assert.equal(status, 401);
		assert.equal(body.error.code, 'UNAUTHENTICATED');
	} finally {
		await close(server);
	}
});

test('POST /history with invalid token returns 401', async () => {
	const app = mountThreadApp();
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status } = await fetchJson(`http://127.0.0.1:${port}`, '/history', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer bad-token',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ user_id: USER_A.airtableId }),
		});
		assert.equal(status, 401);
	} finally {
		await close(server);
	}
});

test('POST /history rejects foreign user_id in body', async () => {
	const app = mountThreadApp();
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/history', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer valid-token-a',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ user_id: USER_B.airtableId }),
		});
		assert.equal(status, 403);
		assert.equal(body.error.code, 'FORBIDDEN');
	} finally {
		await close(server);
	}
});

test('POST /history returns chronological messages from n8n', async () => {
	installN8nFetchMock(async (_url, init) => {
		const payload = JSON.parse(init.body);
		assert.equal(payload.action, 'history');
		assert.equal(payload.user_id, USER_A.airtableId);
		return new Response(JSON.stringify({
			messages: [
				{ role: 'user', content: 'bonjour', timestamp: '2026-01-01T10:00:00.000Z' },
				{ role: 'assistant', content: 'salut', timestamp: '2026-01-01T10:00:01.000Z' },
			],
		}), { status: 200, headers: { 'Content-Type': 'application/json' } });
	});

	const app = mountThreadApp();
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/history', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer valid-token-a',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ user_id: USER_A.airtableId }),
		});
		assert.equal(status, 200);
		assert.equal(body.success, true);
		assert.equal(body.messages.length, 2);
		assert.equal(body.remote.count, 2);
		assert.equal(body.messages[0].role, 'user');
		assert.equal(body.messages[1].role, 'assistant');
	} finally {
		await close(server);
	}
});

test('POST /thread/message reports remote skipped when save webhook absent', async () => {
	const app = mountThreadApp();
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/thread/message', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer valid-token-a',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				userId: USER_A.airtableId,
				role: 'user',
				content: 'hello thread',
				currency: 'USD',
				clientId: 'evil-client',
			}),
		});
		assert.equal(status, 200);
		assert.equal(body.success, true);
		assert.equal(body.remote.saved, false);
		assert.equal(body.remote.reason, 'webhook_not_configured');
		assert.equal(body.local.managedByClient, true);
	} finally {
		await close(server);
	}
});

test('POST /thread/message rejects foreign userId in body', async () => {
	const app = mountThreadApp();
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/thread/message', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer valid-token-a',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				userId: USER_B.airtableId,
				role: 'assistant',
				content: 'reply text',
			}),
		});
		assert.equal(status, 403);
		assert.equal(body.error.code, 'FORBIDDEN');
	} finally {
		await close(server);
	}
});

test('POST /thread/message forwards metadata and reports remote saved', async () => {
	process.env.N8N_SAVE_MESSAGE_WEBHOOK = 'https://n8n.test/hook/save';

	installN8nFetchMock(async (url, init) => {
		assert.equal(String(url), 'https://n8n.test/hook/save');
		const payload = JSON.parse(init.body);
		assert.equal(payload.userId, USER_A.airtableId);
		assert.equal(payload.pbUserId, USER_A.id);
		assert.equal(payload.role, 'assistant');
		assert.equal(payload.content, 'reply text');
		assert.equal(payload.currency, 'USD');
		assert.equal('clientId' in payload, false);
		return new Response('{}', { status: 200 });
	});

	const app = mountThreadApp();
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/thread/message', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer valid-token-a',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				userId: USER_A.airtableId,
				clientId: 'evil-client',
				role: 'assistant',
				content: 'reply text',
				currency: 'USD',
			}),
		});
		assert.equal(status, 200);
		assert.equal(body.remote.saved, true);
	} finally {
		await close(server);
	}
});

test('GET /thread/:userId rejects foreign userId param', async () => {
	const app = mountThreadApp();
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(
			`http://127.0.0.1:${port}`,
			`/thread/${encodeURIComponent(USER_B.airtableId)}`,
			{
				headers: { Authorization: 'Bearer valid-token-a' },
			},
		);
		assert.equal(status, 403);
		assert.equal(body.error.code, 'FORBIDDEN');
	} finally {
		await close(server);
	}
});

test('GET /thread/:userId falls back to n8n history when dedicated webhook absent', async () => {
	installN8nFetchMock(async (_url, init) => {
		const payload = JSON.parse(init.body);
		assert.equal(payload.action, 'history');
		return new Response(JSON.stringify({
			messages: [{ role: 'user', content: 'saved remotely' }],
		}), { status: 200, headers: { 'Content-Type': 'application/json' } });
	});

	const app = mountThreadApp();
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(
			`http://127.0.0.1:${port}`,
			`/thread/${encodeURIComponent(USER_A.airtableId)}`,
			{ headers: { Authorization: 'Bearer valid-token-a' } },
		);
		assert.equal(status, 200);
		assert.equal(body.messages.length, 1);
		assert.equal(body.remote.source, 'n8n_history_fallback');
	} finally {
		await close(server);
	}
});

test('POST /history propagates n8n failure', async () => {
	installN8nFetchMock(async () => new Response('fail', { status: 502 }));

	const app = mountThreadApp();
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status } = await fetchJson(`http://127.0.0.1:${port}`, '/history', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer valid-token-a',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ user_id: USER_A.airtableId }),
		});
		assert.equal(status, 500);
	} finally {
		await close(server);
	}
});

test('POST /thread/message propagates n8n save failure', async () => {
	process.env.N8N_SAVE_MESSAGE_WEBHOOK = 'https://n8n.test/hook/save';
	installN8nFetchMock(async () => new Response('fail', { status: 503 }));

	const app = mountThreadApp();
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status } = await fetchJson(`http://127.0.0.1:${port}`, '/thread/message', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer valid-token-a',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				userId: USER_A.airtableId,
				role: 'user',
				content: 'hello',
			}),
		});
		assert.equal(status, 500);
	} finally {
		await close(server);
	}
});

test('POST /history returns empty messages for unknown thread', async () => {
	installN8nFetchMock(async () => new Response(JSON.stringify({ messages: [] }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	}));

	const app = mountThreadApp();
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/history', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer valid-token-a',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ user_id: USER_A.airtableId }),
		});
		assert.equal(status, 200);
		assert.equal(body.messages.length, 0);
		assert.equal(body.remote.count, 0);
	} finally {
		await close(server);
	}
});

test('thread route logs do not embed webhook secrets', async () => {
	const src = await import('node:fs/promises').then((fs) =>
		Promise.all([
			fs.readFile(new URL('../src/routes/thread.js', import.meta.url), 'utf8'),
			fs.readFile(new URL('../src/utils/n8n-history.js', import.meta.url), 'utf8'),
		]),
	);
	for (const content of src) {
		assert.doesNotMatch(content, /N8N_.*WEBHOOK\s*=\s*['"]https?:\/\//);
		assert.doesNotMatch(content, /logger\.(info|error|warn)\([^)]*N8N_/);
	}
});
