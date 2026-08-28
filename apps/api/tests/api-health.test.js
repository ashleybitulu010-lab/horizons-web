import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import http from 'node:http';

import apiRoutes from '../src/routes/api/index.js';

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

async function fetchJson(baseUrl, path, headers = {}) {
	const res = await fetch(`${baseUrl}${path}`, { headers });
	const body = await res.json();
	return { status: res.status, body };
}

test('GET /api/health returns structured payload', async () => {
	const app = express();
	app.use('/api', apiRoutes());
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/api/health');
		assert.equal(status, 200);
		assert.equal(body.status, 'ok');
		assert.equal(body.service, 'ash-ledger-api');
		assert.equal(body.checks.runtime, 'ok');
		assert.equal(typeof body.timestamp, 'string');
		assert.equal(typeof body.config, 'object');
		assert.equal('supabaseServiceRoleKey' in body.config, false);
	} finally {
		await close(server);
	}
});

test('GET /api/supabase/status without config returns 503', async () => {
	const previousUrl = process.env.SUPABASE_URL;
	const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	delete process.env.SUPABASE_URL;
	delete process.env.SUPABASE_SERVICE_ROLE_KEY;

	const app = express();
	app.use('/api', apiRoutes());
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/api/supabase/status');
		assert.equal(status, 503);
		assert.equal(body.supabase.configured, false);
		assert.equal(body.supabase.connected, false);
	} finally {
		await close(server);
		if (previousUrl) process.env.SUPABASE_URL = previousUrl;
		if (previousKey) process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
	}
});
