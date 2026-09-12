/**
 * Apply P1-D activity scope backend migration.
 *
 * Staging:
 *   node --env-file=apps/api/.env.staging tools/_apply_p1d_activity_scope.mjs
 *
 * Production (requires P1-B + P1-C applied):
 *   ALLOW_PRODUCTION_MIGRATION=1 node --env-file=<prod-env> tools/_apply_p1d_activity_scope.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = '20260910190000_p1d_activity_scope_backend.sql';
const STAGING_REF = 'vwjkktqcmmhotadicbpg';
const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';

function resolveProjectRef() {
	const url = process.env.SUPABASE_URL || '';
	const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
	return match ? match[1].toLowerCase() : null;
}

function assertAllowedTarget() {
	const ref = resolveProjectRef();
	if (ref === PRODUCTION_REF && process.env.ALLOW_PRODUCTION_MIGRATION !== '1') {
		throw new Error('Production blocked — set ALLOW_PRODUCTION_MIGRATION=1');
	}
	console.log('TARGET:', ref);
	return ref;
}

async function connectPg() {
	const dbUrl = process.env.SUPABASE_DB_URL;
	if (dbUrl) {
		const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
		await client.connect();
		return client;
	}
	const ref = resolveProjectRef();
	const host = process.env.SUPABASE_DB_HOST || (ref ? `db.${ref}.supabase.co` : null);
	const password = process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASS;
	if (!host || !password) throw new Error('DB credentials required');
	const user = /pooler\.supabase\.com/i.test(host) ? `postgres.${ref}` : 'postgres';
	const client = new pg.Client({
		host,
		port: Number(process.env.SUPABASE_DB_PORT || 5432),
		user,
		password,
		database: 'postgres',
		ssl: { rejectUnauthorized: false },
	});
	await client.connect();
	return client;
}

async function main() {
	assertAllowedTarget();
	const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', MIGRATION);
	const sql = fs.readFileSync(sqlPath, 'utf8');
	const client = await connectPg();
	try {
		console.log('Applying', MIGRATION);
		await client.query(sql);
		const { rows } = await client.query(
			`select count(*)::int as n from information_schema.columns
       where table_schema='public' and table_name='agent_sessions' and column_name='activity_id'`,
		);
		console.log('agent_sessions.activity_id present:', rows[0]?.n === 1);
		console.log('P1-D migration applied successfully');
	} finally {
		await client.end();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
