#!/usr/bin/env node
/** Load ASH_TEST_PASSWORD from VPS .env and run H12.6 gate. */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Client } from 'ssh2';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY_PATH = `${process.env.TEMP}/ashledger-deploy-key/ashledger_deploy`;
const webRoot = fileURLToPath(new URL('..', import.meta.url));
const HOST = '187.124.187.13';
const CONTAINER = 'ash-ledger-api-v2-ash-ledger-api-1';

function sshExec(cmd) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        let out = '';
        stream.on('data', (d) => { out += d.toString(); });
        stream.stderr.on('data', (d) => { out += d.toString(); });
        stream.on('close', (code) => {
          conn.end();
          if (code !== 0) reject(new Error(out || `exit ${code}`));
          else resolve(out.trim());
        });
      });
    }).on('error', reject).connect({
      host: HOST,
      username: 'root',
      privateKey: readFileSync(KEY_PATH),
      readyTimeout: 60000,
    });
  });
}

function loadLocalSecureEnv() {
  const envPath = path.join(process.env.TEMP, 'f4-b2-api-prod', 'ketura-pass.env');
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

async function main() {
  const preflight = {
    gitHead: spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: webRoot, encoding: 'utf8' }).stdout?.trim(),
    keyExists: true,
  };

  preflight.containerStatus = await sshExec(`docker ps --filter name=${CONTAINER} --format "{{.Status}}"`);
  preflight.currentBundle = await sshExec('grep -o "assets/index-[^\\"]*\\.js" /opt/ashledger/dist/index.html | head -1');
  console.log('Preflight:', JSON.stringify(preflight, null, 2));

  const localEnv = loadLocalSecureEnv();
  const password = process.env.ASH_TEST_PASSWORD
    || localEnv.ASH_TEST_PASSWORD
    || localEnv.KETURA_PASS
    || process.env.KETURA_PASS;
  if (!password) throw new Error('ASH_TEST_PASSWORD not available (set env or ketura-pass.env)');

  const gate = spawnSync(process.execPath, ['tools/_h126_profit_read_migration_gate.mjs'], {
    cwd: webRoot,
    stdio: 'inherit',
    env: { ...process.env, ASH_TEST_PASSWORD: password },
  });
  process.exit(gate.status ?? 1);
}

main().catch((e) => {
  console.error('H12.6 gate runner failed:', e.message);
  process.exit(1);
});
