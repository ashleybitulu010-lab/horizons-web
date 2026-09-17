#!/usr/bin/env node
/** Deploy H10.2 classifier + action fixes to VPS (no flag changes). */
import { Client } from 'ssh2';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const apiRoot = path.join(webRoot, 'apps/api');
const KEY_PATH = `${process.env.TEMP}/ashledger-deploy-key/ashledger_deploy`;
const REMOTE_API = '/opt/ashledger/apps/api';
const CONTAINER = 'ash-ledger-api-v2-ash-ledger-api-1';

const FILES = [
	'src/agent/intelligence-v2/goal-classifier-rules.js',
	'src/agent/intelligence-v2/action/action-confirmation-handler.js',
	'src/agent/intelligence-v2/action/action-pending-bridge.js',
];

function sshConnect() {
	return new Promise((resolve, reject) => {
		const c = new Client();
		c.on('ready', () => resolve(c)).on('error', reject)
			.connect({ host: '187.124.187.13', username: 'root', privateKey: readFileSync(KEY_PATH) });
	});
}

function sshExec(conn, cmd) {
	return new Promise((resolve, reject) => {
		conn.exec(cmd, (err, st) => {
			if (err) return reject(err);
			let o = '';
			st.on('data', (d) => { o += d.toString(); });
			st.stderr.on('data', (d) => { o += d.toString(); });
			st.on('close', (code) => (code ? reject(new Error(o)) : resolve(o.trim())));
		});
	});
}

function sftpUpload(conn, localPath, remotePath) {
	return new Promise((resolve, reject) => {
		conn.sftp((err, sftp) => {
			if (err) return reject(err);
			sftp.fastPut(localPath, remotePath, (putErr) => (putErr ? reject(putErr) : resolve()));
		});
	});
}

const conn = await sshConnect();
try {
	for (const rel of FILES) {
		await sftpUpload(conn, path.join(apiRoot, rel), `${REMOTE_API}/${rel}`);
	}
	const rebuild = await sshExec(conn, 'cd /docker/ash-ledger-api-v2 && docker compose -f docker-compose.parallel.yml build ash-ledger-api && docker compose -f docker-compose.parallel.yml up -d ash-ledger-api');
	const flags = readFileSync(new URL('./_ashy_v2_phase_h7_prod_flag_audit.sh', import.meta.url), 'utf8');
	const flagOut = await sshExec(conn, `echo ${Buffer.from(flags).toString('base64')} | base64 -d | bash`);
	console.log(JSON.stringify({ deployed: FILES, rebuild: rebuild.slice(0, 120), flags: flagOut.split('\n').filter((l) => /^(OFF|ON):ASHY/.test(l)) }, null, 2));
} finally {
	conn.end();
}
