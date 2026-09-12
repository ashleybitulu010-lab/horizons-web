/**
 * Apply F4-B1 migration to Supabase STAGING only.
 * Usage: node --env-file=apps/api/.env.staging tools/_apply_f4_b1_migration.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAGING_REF = 'vwjkktqcmmhotadicbpg';
const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';

function assertStagingOnly() {
	const url = process.env.SUPABASE_URL || '';
	const allowed = (process.env.STAGING_ALLOWED_SUPABASE_PROJECT_REF || '').trim().toLowerCase();
	const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
	const ref = match ? match[1].toLowerCase() : null;

	if (ref === PRODUCTION_REF || allowed === PRODUCTION_REF) {
		throw new Error('PRODUCTION BLOCKED');
	}
	if (ref !== STAGING_REF) {
		throw new Error(`Expected staging ref ${STAGING_REF}, got ${ref || 'unknown'}`);
	}
	if (allowed && allowed !== STAGING_REF) {
		throw new Error(`STAGING_ALLOWED_SUPABASE_PROJECT_REF must be ${STAGING_REF}`);
	}
}

async function main() {
	assertStagingOnly();

	let host = process.env.SUPABASE_DB_HOST;
	const port = Number(process.env.SUPABASE_DB_PORT || 5432);
	const password = process.env.SUPABASE_DB_PASSWORD;
	const urlMatch = (process.env.SUPABASE_URL || '').match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
	const projectRef = urlMatch ? urlMatch[1].toLowerCase() : null;

	let user = 'postgres';
	if (host && /pooler\.supabase\.com/i.test(host) && projectRef) {
		user = `postgres.${projectRef}`;
	} else if (projectRef && !host) {
		host = `db.${projectRef}.supabase.co`;
	}

	if (!host || !password) {
		throw new Error('SUPABASE_DB_HOST (or SUPABASE_URL) and SUPABASE_DB_PASSWORD required in .env.staging');
	}

	const sqlPaths = [
		path.join(__dirname, '..', 'supabase', 'staging', '001_f4_b1_business_tables_minimal.sql'),
		path.join(__dirname, '..', 'supabase', 'migrations', '20260908120000_confirm_and_create_transactional.sql'),
	];

	const client = new pg.Client({
		host,
		port,
		user,
		password,
		database: 'postgres',
		ssl: { rejectUnauthorized: false },
	});

	await client.connect();
	try {
		for (const sqlPath of sqlPaths) {
			const sql = fs.readFileSync(sqlPath, 'utf8');
			await client.query(sql);
		}
		console.log('F4-B1 staging bootstrap + migration applied');
	} finally {
		await client.end();
	}
}

main().catch((err) => {
	console.error(err.message || err);
	process.exit(1);
});
