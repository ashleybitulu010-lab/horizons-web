/**
 * Phase 5.8-P0-STAGING — apply migrations + verify schema (staging only).
 * Usage: node --env-file=.env.staging tools/_staging-p0-run.mjs [apply|verify]
 * Requires SUPABASE_DB_URL or SUPABASE_DB_PASSWORD in .env.staging for apply/verify-pg.
 */
import { readFileSync, existsSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';
const STAGING_REF = 'vwjkktqcmmhotadicbpg';

function resolveSqlRoot(startDir) {
	let dir = startDir;
	for (let i = 0; i < 8; i += 1) {
		for (const candidate of [dir, join(dir, 'web'), join(dir, '..', 'web')]) {
			const bootstrap = join(candidate, 'supabase', 'staging', '000_bootstrap_minimal.sql');
			if (existsSync(bootstrap)) return candidate;
		}
		dir = join(dir, '..');
	}
	throw new Error('Unable to locate supabase/staging/000_bootstrap_minimal.sql');
}

const ROOT = resolveSqlRoot(dirname(fileURLToPath(import.meta.url)));
const SQL_FILES = [
	join(ROOT, 'supabase', 'staging', '000_bootstrap_minimal.sql'),
	join(ROOT, 'supabase', 'migrations', '20260904180000_conversation_persistence.sql'),
	join(ROOT, 'supabase', 'migrations', '20260905120000_agent_sessions_p0_atomic_ops.sql'),
];

function parseProjectRef(url) {
	const m = String(url || '').match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
	return m ? m[1].toLowerCase() : null;
}

async function connectPgClient() {
	const { Client } = await import('pg');
	const password = (process.env.SUPABASE_DB_PASSWORD || '').trim();
	if (!password && !process.env.SUPABASE_DB_URL) {
		throw new Error('SUPABASE_DB_PASSWORD or SUPABASE_DB_URL required');
	}
	const encoded = encodeURIComponent(password);
	const attempts = [];

	if (process.env.SUPABASE_DB_URL) {
		assertDbUrlSafe(process.env.SUPABASE_DB_URL);
		attempts.push({ connectionString: process.env.SUPABASE_DB_URL.trim(), label: 'env-url' });
	}

	if (process.env.SUPABASE_DB_HOST) {
		const user = (process.env.SUPABASE_DB_USER || `postgres.${STAGING_REF}`).trim();
		const port = Number(process.env.SUPABASE_DB_PORT || '5432');
		attempts.push({
			host: process.env.SUPABASE_DB_HOST.trim(),
			port,
			user,
			password,
			database: 'postgres',
			ssl: { rejectUnauthorized: false },
			label: process.env.SUPABASE_DB_HOST.trim(),
		});
	}

	// Only scan fallbacks when no explicit DB host/URL configured
	if (!process.env.SUPABASE_DB_URL && !process.env.SUPABASE_DB_HOST) {
		const directHost = `db.${STAGING_REF}.supabase.co`;
		try {
			const { address } = await lookup(directHost, { verbatim: true });
			attempts.push({
				host: address,
				port: 5432,
				user: 'postgres',
				password,
				database: 'postgres',
				ssl: { rejectUnauthorized: false },
				label: directHost,
			});
		} catch {
			attempts.push({
				connectionString: `postgresql://postgres:${encoded}@${directHost}:5432/postgres`,
				label: directHost,
			});
		}

		const poolerRegions = [
			'eu-west-1',
			'eu-central-1', 'eu-west-2', 'eu-west-3', 'eu-north-1',
			'us-east-1', 'us-west-1', 'ap-southeast-1', 'ap-northeast-1', 'ap-south-1',
			'ca-central-1', 'sa-east-1',
		];
		for (const region of poolerRegions) {
			for (const prefix of ['aws-1', 'aws-0']) {
				const host = `${prefix}-${region}.pooler.supabase.com`;
				attempts.push({
					connectionString: `postgresql://postgres.${STAGING_REF}:${encoded}@${host}:5432/postgres`,
					label: host,
				});
			}
		}
	}

	const errors = [];
	for (const attempt of attempts) {
		const { label, ...config } = attempt;
		const client = new Client({
			...config,
			connectionTimeoutMillis: 10000,
			ssl: { rejectUnauthorized: false },
		});
		try {
			await client.connect();
			return { client, host: label, user: config.user || `postgres.${STAGING_REF}` };
		} catch (err) {
			errors.push(`${attempt.label}: ${err.message}`);
		}
	}

	throw new Error(`Unable to connect to staging PostgreSQL (${errors.slice(-3).join(' | ')})`);
}

function assertStagingEnv() {
	const url = process.env.SUPABASE_URL || '';
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
	const allowed = (process.env.STAGING_ALLOWED_SUPABASE_PROJECT_REF || '').trim().toLowerCase();
	const ref = parseProjectRef(url);

	if (ref !== STAGING_REF) {
		throw new Error(`STOP: project ref must be ${STAGING_REF}, got ${ref || 'ABSENT'}`);
	}
	if (ref === PRODUCTION_REF) {
		throw new Error('STOP: production project ref detected');
	}
	if (process.env.RUN_STAGING !== 'true') {
		throw new Error('STOP: RUN_STAGING must be true');
	}
	if (allowed !== STAGING_REF) {
		throw new Error('STOP: STAGING_ALLOWED_SUPABASE_PROJECT_REF mismatch');
	}
	if ((process.env.NODE_ENV || 'development') === 'production') {
		throw new Error('STOP: NODE_ENV is production');
	}
	if (!url || !key) {
		throw new Error('STOP: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
	}

	return { url, key, ref };
}

function assertDbUrlSafe(dbUrl) {
	if (dbUrl.includes(PRODUCTION_REF)) {
		throw new Error('STOP: database URL points to production');
	}
	if (!dbUrl.includes(STAGING_REF)) {
		throw new Error('STOP: database URL must reference staging project ref');
	}
}

function createAdminClient(url, key) {
	return createClient(url, key, {
		auth: { autoRefreshToken: false, persistSession: false },
		global: {
			headers: {
				apikey: key,
				Authorization: `Bearer ${key}`,
			},
		},
	});
}

async function verifyViaRest(admin) {
	const checks = {};

	const { error: clientsErr } = await admin.from('clients').select('id').limit(1);
	checks.clients = clientsErr ? `MISSING (${clientsErr.code})` : 'OK';

	const { error: sessionsErr } = await admin
		.from('agent_sessions')
		.select('state_version')
		.limit(1);
	checks.agent_sessions = sessionsErr ? `MISSING (${sessionsErr.code})` : 'OK';

	for (const fn of ['mirror_agent_sessions_atomic', 'consume_agent_pending']) {
		const { error } = await admin.rpc(fn, {
			p_client_id: '00000000-0000-0000-0000-000000000001',
		});
		// P0001 / 22P02 / client not found = function exists
		checks[fn] = error?.message?.includes('client not found')
			|| error?.message?.includes('client_id required')
			|| error?.code === 'P0001'
			? 'OK'
			: `FAIL (${error?.code || 'unknown'}: ${error?.message || 'no error'})`;
	}

	return checks;
}

async function applySqlFiles() {
	const { client, host } = await connectPgClient();
	const results = [{ probe: 'connect', status: 'PASS', host }];

	for (const file of SQL_FILES) {
		const sql = readFileSync(file, 'utf8');
		const label = file.split(/[/\\]/).slice(-2).join('/');
		try {
			await client.query(sql);
			results.push({ file: label, status: 'PASS' });
		} catch (err) {
			results.push({ file: label, status: 'FAIL', error: err.message });
			await client.end();
			return results;
		}
	}

	await client.end();
	return results;
}

async function verifySchemaPg() {
	const { client } = await connectPgClient();

	const tables = await client.query(`
		select table_name from information_schema.tables
		where table_schema = 'public'
		  and table_name in ('clients', 'chat_messages', 'agent_sessions', 'chat_message_counters')
		order by table_name
	`);

	const columns = await client.query(`
		select table_name, column_name
		from information_schema.columns
		where table_schema = 'public'
		  and (
		    (table_name = 'agent_sessions' and column_name in ('state_version', 'pending_consume_token'))
		    or (table_name = 'clients' and column_name = 'auth_user_id')
		  )
		order by table_name, column_name
	`);

	const routines = await client.query(`
		select routine_name, routine_type
		from information_schema.routines
		where routine_schema = 'public'
		  and routine_name in (
		    'ash_owns_client',
		    'allocate_chat_message_sequence',
		    'mirror_agent_sessions_atomic',
		    'consume_agent_pending'
		  )
		order by routine_name
	`);

	const grants = await client.query(`
		select routine_name, grantee, privilege_type
		from information_schema.routine_privileges
		where routine_schema = 'public'
		  and routine_name in (
		    'allocate_chat_message_sequence',
		    'mirror_agent_sessions_atomic',
		    'consume_agent_pending'
		  )
		  and grantee in ('service_role', 'postgres')
		order by routine_name, grantee
	`);

	await client.end();

	return {
		tables: tables.rows.map((r) => r.table_name),
		columns: columns.rows,
		pendingConsumeTokenNote:
			'No DB column pending_consume_token — token stored in agent_sessions.payload.consumeToken (JSON)',
		routines: routines.rows,
		grants: grants.rows,
	};
}

async function main() {
	const mode = process.argv[2] || 'verify';
	const env = assertStagingEnv();
	console.log(JSON.stringify({
		phase: '5.8-P0-STAGING',
		mode,
		projectRef: env.ref,
		supabaseUrl: env.url,
		productionBlocked: env.ref !== PRODUCTION_REF,
		serviceRoleKey: 'PRESENT',
		dbPassword: process.env.SUPABASE_DB_PASSWORD ? 'PRESENT' : 'ABSENT',
	}, null, 2));

	const hasDbPassword = Boolean(process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);

	if (mode === 'apply') {
		if (!hasDbPassword) {
			console.error('BLOCKER: SUPABASE_DB_URL or SUPABASE_DB_PASSWORD required for apply');
			process.exit(2);
		}
		const results = await applySqlFiles();
		console.log(JSON.stringify({ apply: results }, null, 2));
		if (results.some((r) => r.status === 'FAIL')) process.exit(1);
		return;
	}

	if (mode === 'verify-pg') {
		if (!hasDbPassword) {
			console.error('BLOCKER: SUPABASE_DB_URL or SUPABASE_DB_PASSWORD required for verify-pg');
			process.exit(2);
		}
		const schema = await verifySchemaPg();
		console.log(JSON.stringify({ schema }, null, 2));
		return;
	}

	const admin = createAdminClient(env.url, env.key);
	const rest = await verifyViaRest(admin);
	console.log(JSON.stringify({ restVerify: rest }, null, 2));
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
