import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import http from 'node:http';

import apiRoutes from '../src/routes/api/index.js';
import { requireAuth, rejectForeignIdentity } from '../src/middleware/auth.js';
import {
	resetTokenVerifierForTests,
	setTokenVerifierForTests,
} from '../src/services/pocketbase-auth.js';
import { createToolExecutionContext } from '../src/tools/context.js';

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
	return { status: res.status, body, res };
}

test.beforeEach(() => {
	setTokenVerifierForTests(async (token) => {
		if (token === 'valid-token-a') return USER_A;
		if (token === 'valid-token-b') return USER_B;
		return null;
	});
});

test.afterEach(() => {
	resetTokenVerifierForTests();
});

test('Case 1: unauthenticated request returns 401', async () => {
	const app = express();
	app.use('/api', apiRoutes());
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/api/me');
		assert.equal(status, 401);
		assert.equal(body.error.code, 'UNAUTHENTICATED');
	} finally {
		await close(server);
	}
});

test('Case 2: invalid token returns 401', async () => {
	const app = express();
	app.use('/api', apiRoutes());
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/api/me', {
			headers: { Authorization: 'Bearer invalid-token' },
		});
		assert.equal(status, 401);
		assert.equal(body.error.code, 'UNAUTHENTICATED');
	} finally {
		await close(server);
	}
});

test('Case 3: authenticated user builds req.user correctly', async () => {
	const app = express();
	app.use('/api', apiRoutes());
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/api/me', {
			headers: { Authorization: 'Bearer valid-token-a' },
		});
		assert.equal(status, 200);
		assert.equal(body.user.id, USER_A.id);
		assert.equal(body.user.email, USER_A.email);
		assert.equal(body.user.businessUserId, USER_A.airtableId);
	} finally {
		await close(server);
	}
});

test('Case 4: user A cannot use identity of user B', async () => {
	const app = express();
	app.use(express.json());
	app.post('/echo-user', requireAuth, rejectForeignIdentity, (req, res) => {
		res.json({ ok: true });
	});
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/echo-user', {
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

test('Case 5: matching body identity is allowed; req.user remains authoritative', async () => {
	const app = express();
	app.use(express.json());
	app.post('/echo-user', requireAuth, rejectForeignIdentity, (req, res) => {
		res.json({ userId: req.user.id, businessUserId: req.user.businessUserId });
	});
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/echo-user', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer valid-token-a',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ userId: USER_A.airtableId, pbUserId: USER_A.id }),
		});
		assert.equal(status, 200);
		assert.equal(body.userId, USER_A.id);
		assert.equal(body.businessUserId, USER_A.airtableId);
	} finally {
		await close(server);
	}
});

test('Case 6: tool context requires authenticated req.user', () => {
	assert.throws(
		() => createToolExecutionContext({}),
		/Authenticated user context is required/,
	);

	const ctx = createToolExecutionContext({
		user: {
			id: USER_A.id,
			businessUserId: USER_A.airtableId,
			clientId: null,
		},
	});
	assert.equal(ctx.user.id, USER_A.id);
});
