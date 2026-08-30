import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

import healthCheck from '../src/routes/health-check.js';
import apiRoutes from '../src/routes/api/index.js';
import { TOOL_NAMES } from '../src/tools/definitions.js';

const API_ROOT = path.resolve(import.meta.dirname, '..');

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

async function fetchJson(baseUrl, routePath, options = {}) {
	const res = await fetch(`${baseUrl}${routePath}`, options);
	const body = await res.json().catch(() => ({}));
	return { status: res.status, body };
}

function mountProductionRoutes() {
	const app = express();
	app.use(express.json());

	const apiRouter = express.Router();
	apiRouter.get('/health', healthCheck);
	apiRouter.use('/api', apiRoutes());

	app.use('/hcgi/api', apiRouter);
	app.use('/', apiRouter);

	return app;
}

test('Dockerfile uses node src/main.js and production port 3000', () => {
	const dockerfile = fs.readFileSync(path.join(API_ROOT, 'Dockerfile'), 'utf8');
	assert.match(dockerfile, /FROM node:20/);
	assert.match(dockerfile, /ENV PORT=3000/);
	assert.match(dockerfile, /CMD \["node", "src\/main\.js"\]/);
	assert.doesNotMatch(dockerfile, /SUPABASE_SERVICE_ROLE|JWT_SECRET|password/i);
});

test('docker-compose maps host 3001 to container 3000', () => {
	const compose = fs.readFileSync(path.join(API_ROOT, 'docker-compose.yml'), 'utf8');
	assert.match(compose, /127\.0\.0\.1:3001:3000/);
	assert.match(compose, /dockerfile: Dockerfile/);
	assert.doesNotMatch(compose, /SUPABASE_SERVICE_ROLE_KEY=/);
});

test('app.js mounts routes under /hcgi/api for nginx proxy', () => {
	const src = fs.readFileSync(path.join(API_ROOT, 'src', 'app.js'), 'utf8');
	assert.match(src, /app\.use\(['"]\/hcgi\/api['"],\s*apiRouter\)/);
});

test('GET /hcgi/api/health returns legacy-compatible payload', async () => {
	const app = mountProductionRoutes();
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/hcgi/api/health');
		assert.equal(status, 200);
		assert.equal(body.ok, true);
		assert.equal(body.status, 'ok');
		assert.equal(body.service, 'ash-ledger-api');
	} finally {
		await close(server);
	}
});

test('GET /hcgi/api/api/health returns structured Ashy health', async () => {
	const app = mountProductionRoutes();
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status, body } = await fetchJson(`http://127.0.0.1:${port}`, '/hcgi/api/api/health');
		assert.equal(status, 200);
		assert.equal(body.status, 'ok');
		assert.equal(body.service, 'ash-ledger-api');
		assert.equal(typeof body.config, 'object');
		assert.equal('supabaseServiceRoleKey' in (body.config || {}), false);
	} finally {
		await close(server);
	}
});

test('POST /hcgi/api/api/ashy/chat without auth returns 401 not 404', async () => {
	const app = mountProductionRoutes();
	const server = await listen(app);
	const { port } = server.address();

	try {
		const { status } = await fetchJson(`http://127.0.0.1:${port}`, '/hcgi/api/api/ashy/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message: 'test' }),
		});
		assert.equal(status, 401);
	} finally {
		await close(server);
	}
});

test('create_expense tool is registered for Phase 4.0/4.1', () => {
	assert.ok(TOOL_NAMES.includes('create_expense'));
});
