/**
 * Apply execute_batch_operations RPC migration on production Supabase (via VPS docker).
 * Run: npm install pg ssh2 --no-save && node tools/_apply_batch_rpc.mjs
 */
import { Client } from 'ssh2';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const keyPath = `${process.env.TEMP}/ashledger-deploy-key/ashledger_deploy`;
const key = readFileSync(keyPath);
const sql = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/20260814143000_batch_operations_rpc.sql', import.meta.url)),
  'utf8',
);

writeFileSync(`${process.env.TEMP}/ssh-deploy-ash/batch_rpc.sql`, sql);

const remoteJs = `
const { Client } = require('pg');
const fs = require('fs');
const sql = fs.readFileSync('/tmp/batch_rpc.sql', 'utf8');
(async () => {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log('CONNECTED');
  await c.query(sql);
  const chk = await c.query(
    "select proname from pg_proc join pg_namespace n on n.oid = pronamespace where n.nspname = 'public' and proname = 'execute_batch_operations'"
  );
  console.log('RPC_EXISTS=' + (chk.rowCount > 0));
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
`;

const conn = new Client();
conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) throw err;
    sftp.writeFile('/tmp/batch_rpc.sql', sql, (e1) => {
      if (e1) throw e1;
      sftp.writeFile('/tmp/apply_batch_rpc.js', remoteJs, (e2) => {
        if (e2) throw e2;
        const cmd = [
          'docker cp /tmp/batch_rpc.sql ash-ledger-api-ash-ledger-api-1:/tmp/batch_rpc.sql',
          'docker cp /tmp/apply_batch_rpc.js ash-ledger-api-ash-ledger-api-1:/tmp/apply_batch_rpc.js',
          "docker exec -w /app ash-ledger-api-ash-ledger-api-1 sh -c 'npm install pg --no-save --prefix /tmp/pgmod >/tmp/pginstall.log 2>&1; NODE_PATH=/tmp/pgmod/node_modules node /tmp/apply_batch_rpc.js'",
        ].join(' && ');
        conn.exec(cmd, (e3, stream) => {
          if (e3) throw e3;
          stream.on('data', (d) => process.stdout.write(d));
          stream.stderr.on('data', (d) => process.stderr.write(d));
          stream.on('close', (code) => {
            conn.end();
            process.exit(code === 0 ? 0 : 1);
          });
        });
      });
    });
  });
}).connect({ host: '187.124.187.13', port: 22, username: 'root', privateKey: key });
