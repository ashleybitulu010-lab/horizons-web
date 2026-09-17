#!/usr/bin/env node
/**
 * H12.2 — Build and deploy frontend with VITE_ASHY_READ_EXPENSES=true.
 * Rollback: run _deploy_frontend_vps.mjs (default flag OFF) or set env false here.
 */
import { Client } from 'ssh2';
import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HOST = '187.124.187.13';
const APP_DIR = '/opt/ashledger';
const KEY_PATH = `${process.env.TEMP}/ashledger-deploy-key/ashledger_deploy`;
const webRoot = fileURLToPath(new URL('..', import.meta.url));
const buildOut = path.join(webRoot, '.dist-h122');
const bridgeSrc = fileURLToPath(new URL('./support-bridge-server.mjs', import.meta.url));
const EXPENSES_FLAG = String(process.env.VITE_ASHY_READ_EXPENSES ?? 'true').toLowerCase();

if (!existsSync(KEY_PATH)) {
  console.error('SSH key missing:', KEY_PATH);
  process.exit(1);
}

function sshExec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      stream.on('data', (d) => { out += d.toString(); });
      stream.stderr.on('data', (d) => { errOut += d.toString(); });
      stream.on('close', (code) => {
        if (code !== 0) reject(new Error(`exit ${code}: ${errOut || out}`));
        else resolve(out);
      });
    });
  });
}

function sshUpload(conn, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastPut(localPath, remotePath, (e) => (e ? reject(e) : resolve()));
    });
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => resolve(conn))
      .on('error', reject)
      .connect({ host: HOST, username: 'root', privateKey: readFileSync(KEY_PATH), readyTimeout: 60000 });
  });
}

async function main() {
  const conn = await connect();
  console.log('Connected to VPS (H12.2 deploy)');

  const envRaw = await sshExec(conn, `grep -E '^VITE_SUPABASE_(URL|ANON_KEY)=' ${APP_DIR}/.env 2>/dev/null || true`);
  const env = {
    VITE_ASHY_READ_EXPENSES: EXPENSES_FLAG === 'true' ? 'true' : 'false',
  };
  for (const line of envRaw.split(/\r?\n/)) {
    const m = line.match(/^VITE_SUPABASE_(URL|ANON_KEY)=(.*)$/);
    if (m) env[`VITE_SUPABASE_${m[1]}`] = m[2];
  }
  if (!env.VITE_SUPABASE_ANON_KEY) {
    throw new Error('VITE_SUPABASE_ANON_KEY not found on VPS .env');
  }
  env.VITE_SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://knrwplidgvuvjnuqqmrt.supabase.co';
  console.log('Build flags:', { VITE_ASHY_READ_EXPENSES: env.VITE_ASHY_READ_EXPENSES });

  rmSync(buildOut, { recursive: true, force: true });
  mkdirSync(buildOut, { recursive: true });

  console.log('Building frontend with H12.2 flag...');
  execSync('npm install', { cwd: webRoot, stdio: 'inherit', env: { ...process.env, ...env } });
  execSync('node tools/generate-llms.js || true', { cwd: webRoot, stdio: 'inherit', shell: true });
  execSync(`npx vite build --outDir "${buildOut}"`, {
    cwd: webRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });

  const indexHtml = readFileSync(path.join(buildOut, 'index.html'), 'utf8');
  const bundleMatch = indexHtml.match(/assets\/index-[^"]+\.js/);
  if (!bundleMatch) throw new Error('Build missing index bundle');
  const bundlePath = path.join(buildOut, bundleMatch[0]);
  const bundleText = readFileSync(bundlePath, 'utf8');
  const marker = env.VITE_ASHY_READ_EXPENSES === 'true'
    ? { pass: bundleText.includes('quelles sont mes d') || bundleText.includes('EXPENSES') }
    : { pass: true, note: 'rollback build — marker check skipped' };
  console.log('Built bundle:', bundleMatch[0], 'H12.2 marker:', marker);

  const ts = Date.now();
  const remoteTar = `/tmp/ashledger-dist-h122-${ts}.tar.gz`;
  const localTar = path.join(webRoot, `.dist-h122-${ts}.tar.gz`);
  execSync(`tar -czf "${localTar}" -C "${buildOut}" .`, { stdio: 'inherit', shell: true });

  console.log('Uploading dist tarball...');
  await sshUpload(conn, localTar, remoteTar);

  const deployCmd = `
set -euo pipefail
BACKUP="${APP_DIR}/.dist-backup-h122-${ts}"
[ -d "${APP_DIR}/dist" ] && cp -a "${APP_DIR}/dist" "$BACKUP"
mkdir -p "${APP_DIR}/dist"
tar -xzf "${remoteTar}" -C "${APP_DIR}/dist"
chmod -R u=rwX,go=rX "${APP_DIR}/dist"
rm -f "${remoteTar}"
nginx -t && systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || true
grep -o 'assets/index-[^\\"]*\\.js' "${APP_DIR}/dist/index.html" | head -1
`;
  const remoteBundle = (await sshExec(conn, deployCmd)).trim();
  console.log('Remote dist bundle:', remoteBundle);

  await sshUpload(conn, bridgeSrc, '/tmp/support-bridge-server.mjs');
  await sshExec(conn, `
set -e
cp /tmp/support-bridge-server.mjs /opt/ashledger-support-bridge/server.mjs
systemctl restart ashledger-support-bridge
sleep 1
systemctl is-active ashledger-support-bridge
`);

  const live = execSync('curl -sS https://ashledger.tech/', { encoding: 'utf8' });
  const liveBundle = live.match(/assets\/index-[^"]+\.js/)?.[0] || '';
  console.log('Live bundle:', liveBundle);

  writeFileSync(path.join(webRoot, '.dist-h122-deploy.json'), JSON.stringify({
    phase: 'H12.2',
    flag: env.VITE_ASHY_READ_EXPENSES,
    bundle: liveBundle || remoteBundle,
    ts,
  }, null, 2));

  conn.end();
  rmSync(localTar, { force: true });
  rmSync(buildOut, { recursive: true, force: true });
  console.log('H12.2 deploy complete.');
}

main().catch((e) => {
  console.error('H12.2 deploy failed:', e.message);
  process.exit(1);
});
