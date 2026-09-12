/**
 * Apply P1-C activity scope migration (and prerequisites if needed).
 *
 * Staging:
 *   node --env-file=apps/api/.env.staging tools/_apply_p1c_activity_scope.mjs
 *
 * Production (P1-B already applied — P1-C only):
 *   ALLOW_PRODUCTION_MIGRATION=1 P1C_ONLY=1 node --env-file=<prod-env> tools/_apply_p1c_activity_scope.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const STAGING_DIR = path.join(__dirname, '..', 'supabase', 'staging');
const STAGING_REF = 'vwjkktqcmmhotadicbpg';
const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';

const P1C_MIGRATION = '20260910180000_add_activity_scope_business_tables.sql';
const P1B_MIGRATION = '20260910160000_create_activities.sql';

function resolveProjectRef() {
	const url = process.env.SUPABASE_URL || '';
	const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
	return match ? match[1].toLowerCase() : null;
}

function assertAllowedTarget() {
	const ref = resolveProjectRef();
	const allowProd = process.env.ALLOW_PRODUCTION_MIGRATION === '1';

	if (ref === PRODUCTION_REF && !allowProd) {
		throw new Error('Production blocked — set ALLOW_PRODUCTION_MIGRATION=1');
	}
	if (ref === PRODUCTION_REF) {
		console.log('TARGET: production', ref);
		return ref;
	}
	if (ref === STAGING_REF) {
		console.log('TARGET: staging', ref);
		return ref;
	}
	throw new Error(`Unexpected Supabase project ref: ${ref || 'unknown'}`);
}

async function connectPg() {
	const ref = resolveProjectRef();
	const dbUrl = process.env.SUPABASE_DB_URL;
	if (dbUrl) {
		return new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
	}

	let host = process.env.SUPABASE_DB_HOST;
	const port = Number(process.env.SUPABASE_DB_PORT || 5432);
	const password = process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASS;
	let user = 'postgres';
	if (host && /pooler\.supabase\.com/i.test(host) && ref) {
		user = `postgres.${ref}`;
	} else if (ref && !host) {
		host = `db.${ref}.supabase.co`;
	}
	if (!host || !password) {
		throw new Error('SUPABASE_DB_URL or SUPABASE_DB_HOST + password required');
	}
	return new pg.Client({ host, port, user, password, database: 'postgres', ssl: { rejectUnauthorized: false } });
}

async function regclass(client, name) {
	const { rows } = await client.query('select to_regclass($1) as r', [name]);
	return rows[0]?.r;
}

async function columnExists(client, table, column) {
	const { rows } = await client.query(
		`select 1 from information_schema.columns
     where table_schema='public' and table_name=$1 and column_name=$2`,
		[table, column],
	);
	return rows.length > 0;
}

async function applyFile(client, label, filePath) {
	if (!fs.existsSync(filePath)) {
		throw new Error(`Missing migration file: ${filePath}`);
	}
	const sql = fs.readFileSync(filePath, 'utf8');
	console.log('Applying', label);
	await client.query(sql);
}

async function main() {
	const ref = assertAllowedTarget();
	const p1cOnly = process.env.P1C_ONLY === '1' || ref === PRODUCTION_REF;
	const client = await connectPg();
	await client.connect();

	try {
		if (!p1cOnly) {
			if (!(await regclass(client, 'public.depenses'))) {
				await applyFile(client, 'staging bootstrap business tables', path.join(STAGING_DIR, '001_f4_b1_business_tables_minimal.sql'));
			}
			if (!(await regclass(client, 'public.paiements_dettes'))) {
				console.log('Creating minimal paiements_dettes for staging harness');
				await client.query(`
          create table if not exists public.paiements_dettes (
            id uuid primary key default gen_random_uuid(),
            client_id uuid not null references public.clients(id) on delete cascade,
            vente_id uuid not null references public.ventes(id) on delete cascade,
            montant numeric not null check (montant >= 0),
            paid_at timestamptz not null default now(),
            created_at timestamptz not null default now()
          );
          grant all on table public.paiements_dettes to service_role;
        `);
			}
			if (!(await columnExists(client, 'clients', 'nom_activite'))) {
				console.log('Applying staging legacy activity columns on clients');
				await client.query(`
          alter table public.clients
            add column if not exists nom_activite text,
            add column if not exists type_activite text;
        `);
			}
			if (!(await regclass(client, 'public.activities'))) {
				await applyFile(client, P1B_MIGRATION, path.join(MIGRATIONS_DIR, P1B_MIGRATION));
			}
		} else {
			console.log('P1C_ONLY — skipping P1-B prerequisites');
		}

		if (await columnExists(client, 'depenses', 'activity_id')) {
			console.log('P1-C already applied (depenses.activity_id exists)');
		} else {
			await applyFile(client, P1C_MIGRATION, path.join(MIGRATIONS_DIR, P1C_MIGRATION));
		}

		const verify = await client.query(`
			select
			  (select count(*)::int from public.clients) as clients,
			  (select count(*)::int from public.activities) as activities,
			  (select count(*)::int from public.depenses where activity_id is null) as depenses_null,
			  (select count(*)::int from public.produits where activity_id is null) as produits_null,
			  (select count(*)::int from information_schema.columns where table_schema='public' and column_name='activity_id') as activity_id_columns
		`);
		console.log('P1-C verify', verify.rows[0]);
	} finally {
		await client.end();
	}
}

main().catch((err) => {
	console.error(err.message || err);
	process.exit(1);
});
