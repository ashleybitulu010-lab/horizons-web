#!/usr/bin/env node
/**
 * H12.1.1 — Deploy READ routing observability to VPS API container.
 */
import { Client } from 'ssh2';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const apiRoot = path.join(webRoot, 'apps', 'api');
const KEY_PATH = `${process.env.TEMP}/ashledger-deploy-key/ashledger_deploy`;
const HOST = '187.124.187.13';
const REMOTE_API = '/opt/ashledger/apps/api';
const CONTAINER = 'ash-ledger-api-v2-ash-ledger-api-1';

const FILES = [
	'src/observability/read-capability-inference.js',
	'src/observability/read-routing-observability.js',
	'src/routes/api/read-routing-metrics.js',
	'src/routes/api/index.js',
	'src/routes/api/ashy-chat.js',
	'src/routes/chat.js',
	'tests/read-routing-observability.test.js',
];

function sshConnect() {
	return new Promise((resolve, reject) => {
		const conn = new Client();
		conn.on('ready', () => resolve(conn)).on('error', reject)
			.connect({ host: HOST, username: 'root', privateKey: readFileSync(KEY_PATH) });
	});
}

function sshExec(conn, cmd) {
	return new Promise((resolve, reject) => {
		conn.exec(cmd, (err, stream) => {
			if (err) return reject(err);
			let out = '';
			stream.on('data', (d) => { out += d.toString(); });
			stream.stderr.on('data', (d) => { out += d.toString(); });
			stream.on('close', (code) => {
				if (code !== 0) reject(new Error(out || `exit ${code}`));
				else resolve(out.trim());
			});
		});
	});
}

function sftpUpload(conn, localPath, remotePath) {
	return new Promise((resolve, reject) => {
		conn.sftp((err, sftp) => {
			if (err) return reject(err);
			sftp.fastPut(localPath, remotePath, (putErr) => {
				if (putErr) reject(putErr);
				else resolve();
			});
		});
	});
}

async function main() {
	const conn = await sshConnect();
	const deployed = [];
	try {
		for (const rel of FILES) {
			const local = path.join(apiRoot, rel);
			const remote = `${REMOTE_API}/${rel.replace(/\\/g, '/')}`;
			await sftpUpload(conn, local, remote);
			deployed.push(rel);
		}

		const rebuildOut = await sshExec(
			conn,
			'cd /docker/ash-ledger-api-v2 && docker compose -f docker-compose.parallel.yml build ash-ledger-api && docker compose -f docker-compose.parallel.yml up -d ash-ledger-api',
		);

		const marker = await sshExec(
			conn,
			`docker exec ${CONTAINER} node -e "import('./src/observability/read-routing-observability.js').then(m=>console.log(typeof m.getReadRoutingMetricsSnapshot))"`,
		);

		console.log(JSON.stringify({
			phase: 'H12.1.1',
			deployed,
			rebuildTail: rebuildOut.split('\n').slice(-2),
			marker,
		}, null, 2));
	} finally {
		conn.end();
	}
}

main().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
