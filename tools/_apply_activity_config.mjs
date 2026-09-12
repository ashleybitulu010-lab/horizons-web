/**
 * Apply activity configuration columns migration on production Supabase (via VPS docker).
 * Run: node tools/_apply_activity_config.mjs
 */
import { Client } from 'ssh2';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const keyPath = `${process.env.TEMP}/ashledger-deploy-key/ashledger_deploy`;
const key = readFileSync(keyPath);
const sql = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/20260818180000_activity_configuration.sql', import.meta.url)),
  'utf8',
);

const remoteJs = `
const { Client } = require('pg');
const fs = require('fs');
const sql = fs.readFileSync('/tmp/activity_config.sql', 'utf8');
(async () => {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log('CONNECTED');
  await c.query(sql);
  const chk = await c.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'configuration_completed'"
  );
  console.log('COLUMN_EXISTS=' + (chk.rowCount > 0));
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
`;

const conn = new Client();
conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) throw err;
    sftp.writeFile('/tmp/activity_config.sql', sql, (e1) => {
      if (e1) throw e1;
      sftp.writeFile('/tmp/apply_activity_config.js', remoteJs, (e2) => {
        if (e2) throw e2;
        const cmd = [
          'docker cp /tmp/activity_config.sql ash-ledger-api-ash-ledger-api-1:/tmp/activity_config.sql',
          'docker cp /tmp/apply_activity_config.js ash-ledger-api-ash-ledger-api-1:/tmp/apply_activity_config.js',
          "docker exec -w /app ash-ledger-api-ash-ledger-api-1 sh -c 'npm install pg --no-save --prefix /tmp/pgmod >/tmp/pginstall.log 2>&1; NODE_PATH=/tmp/pgmod/node_modules node /tmp/apply_activity_config.js'",
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
