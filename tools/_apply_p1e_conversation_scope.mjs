/**
 * Apply P1-E conversation activity scope migration.
 *
 * Staging:
 *   node --env-file=apps/api/.env.staging tools/_apply_p1e_conversation_scope.mjs
 *
 * Production:
 *   ALLOW_PRODUCTION_MIGRATION=1 node --env-file=<prod-env> tools/_apply_p1e_conversation_scope.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = '20260910195000_p1e_conversation_activity_scope.sql';
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
		const pre = await client.query(`
			select
				(select count(*)::int from public.chat_messages) as total_messages,
				(select count(*)::int from public.chat_messages m
				 where public.ash_resolve_default_activity(m.client_id) is null) as no_default,
				(select count(*)::int from public.chat_messages m
				 left join public.clients c on c.id = m.client_id
				 where c.id is null) as orphaned
		`);
		console.log('DRY_RUN_BEFORE:', JSON.stringify(pre.rows[0]));
		const dry = pre.rows[0] || {};
		if (Number(dry.no_default) > 0 || Number(dry.orphaned) > 0) {
			throw new Error('Dry run failed — unresolved chat_messages');
		}

		console.log('Applying', MIGRATION);
		await client.query(sql);

		const { rows } = await client.query(
			`select count(*)::int as n from information_schema.columns
       where table_schema='public' and table_name='chat_messages' and column_name='activity_id'`,
		);
		console.log('chat_messages.activity_id present:', rows[0]?.n === 1);

		const dryAfter = await client.query('select public.p1e_chat_backfill_dry_run() as report');
		console.log('DRY_RUN_AFTER:', JSON.stringify(dryAfter.rows[0]?.report));
		console.log('P1-E migration applied successfully');
	} finally {
		await client.end();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
