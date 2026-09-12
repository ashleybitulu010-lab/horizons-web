/**
 * Apply P1-B activities migration via direct Postgres connection.
 * Usage (staging only by default):
 *   node --env-file=apps/api/.env.staging tools/_apply_p1b_activities.mjs
 *
 * Production requires ALLOW_PRODUCTION_MIGRATION=1 and matching project ref.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAGING_REF = 'vwjkktqcmmhotadicbpg';
const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';
const MIGRATION = path.join(__dirname, '..', 'supabase', 'migrations', '20260910160000_create_activities.sql');

function resolveProjectRef() {
	const url = process.env.SUPABASE_URL || '';
	const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
	return match ? match[1].toLowerCase() : null;
}

function assertAllowedTarget() {
	const ref = resolveProjectRef();
	const allowProd = process.env.ALLOW_PRODUCTION_MIGRATION === '1';

	if (ref === PRODUCTION_REF && !allowProd) {
		throw new Error('Production blocked — set ALLOW_PRODUCTION_MIGRATION=1 to apply P1-B on production');
	}
	if (ref === PRODUCTION_REF) {
		console.log('TARGET: production', ref);
		return;
	}
	if (ref === STAGING_REF) {
		console.log('TARGET: staging', ref);
		return;
	}
	throw new Error(`Unexpected Supabase project ref: ${ref || 'unknown'}`);
}

async function main() {
	assertAllowedTarget();

	let host = process.env.SUPABASE_DB_HOST;
	const port = Number(process.env.SUPABASE_DB_PORT || 5432);
	const password = process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASS;
	const ref = resolveProjectRef();

	let user = 'postgres';
	if (host && /pooler\.supabase\.com/i.test(host) && ref) {
		user = `postgres.${ref}`;
	} else if (ref && !host) {
		host = `db.${ref}.supabase.co`;
	}

	const dbUrl = process.env.SUPABASE_DB_URL;
	const client = dbUrl
		? new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
		: new pg.Client({ host, port, user, password, database: 'postgres', ssl: { rejectUnauthorized: false } });

	if (!dbUrl && (!host || !password)) {
		throw new Error('SUPABASE_DB_URL or SUPABASE_DB_HOST + password required');
	}

	const sql = fs.readFileSync(MIGRATION, 'utf8');
	await client.connect();
	try {
		await client.query(sql);
		const counts = await client.query(`
			select
			  (select count(*)::int from public.clients) as clients,
			  (select count(*)::int from public.activities) as activities
		`);
		console.log('P1-B migration applied', counts.rows[0]);
	} finally {
		await client.end();
	}
}

main().catch((err) => {
	console.error(err.message || err);
	process.exit(1);
});
