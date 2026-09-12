/**
 * P1-E.1 — READ-ONLY production baseline audit.
 * node --env-file=apps/api/.env tools/_p1e_production_audit.mjs
 */
import pg from 'pg';

const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';

function resolveProjectRef() {
	const url = process.env.SUPABASE_URL || '';
	const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
	return match ? match[1].toLowerCase() : null;
}

async function connectPg() {
	const ref = resolveProjectRef();
	if (ref !== PRODUCTION_REF) {
		throw new Error(`Expected production ${PRODUCTION_REF}, got ${ref || 'unknown'}`);
	}
	const dbUrl = process.env.SUPABASE_DB_URL;
	if (dbUrl) {
		const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
		await client.connect();
		return client;
	}
	const host = process.env.SUPABASE_DB_HOST || `db.${ref}.supabase.co`;
	const password = process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASS;
	if (!password) throw new Error('DB credentials required');
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
	const client = await connectPg();
	try {
		const baseline = {};

		const tables = [
			'clients', 'activities', 'chat_messages', 'chat_message_counters',
			'agent_sessions', 'agent_write_operations', 'ventes', 'depenses',
			'produits', 'stocks', 'paiements_dettes',
		];

		for (const table of tables) {
			const { rows } = await client.query(
				`select count(*)::bigint as n from public.${table}`,
			).catch(() => ({ rows: [{ n: null }] }));
			baseline[table] = rows[0]?.n ?? 'TABLE_MISSING';
		}

		const { rows: activityCol } = await client.query(`
			select count(*)::int as n from information_schema.columns
			where table_schema='public' and table_name='chat_messages' and column_name='activity_id'
		`);
		baseline.chat_messages_activity_id_column = activityCol[0]?.n === 1;

		const { rows: chatDetail } = await client.query(`
			select
				count(*)::int as total,
				count(distinct client_id)::int as distinct_clients,
				count(distinct activity_id)::int as distinct_activities,
				coalesce(min(sequence), 0)::bigint as min_sequence,
				coalesce(max(sequence), 0)::bigint as max_sequence,
				count(*) filter (where activity_id is null)::int as null_activity_id
			from public.chat_messages
		`).catch(() => ({ rows: [{}] }));

		const { rows: dupSeq } = await client.query(`
			select client_id, activity_id, sequence, count(*)::int as n
			from public.chat_messages
			group by client_id, activity_id, sequence
			having count(*) > 1
			limit 5
		`).catch(() => ({ rows: [] }));

		const { rows: activitiesDetail } = await client.query(`
			select
				count(*)::int as total,
				count(distinct client_id)::int as clients_with_activities,
				count(*) filter (where is_default)::int as default_count
			from public.activities
		`).catch(() => ({ rows: [{}] }));

		const { rows: multiDefault } = await client.query(`
			select client_id, count(*)::int as n
			from public.activities where is_default = true
			group by client_id having count(*) > 1
			limit 5
		`).catch(() => ({ rows: [] }));

		const { rows: noDefault } = await client.query(`
			select c.id
			from public.clients c
			left join public.activities a on a.client_id = c.id and a.is_default = true
			where a.id is null
			limit 10
		`).catch(() => ({ rows: [] }));

		const { rows: sessionsDetail } = await client.query(`
			select
				count(*)::int as total,
				count(distinct activity_id)::int as distinct_activities,
				count(*) filter (where activity_id is null)::int as null_activity_id
			from public.agent_sessions
		`).catch(() => ({ rows: [{}] }));

		const { rows: dryRun } = await client.query(`
			select
				(select count(*)::int from public.chat_messages m
				 where public.ash_resolve_default_activity(m.client_id) is null) as no_default,
				(select count(*)::int from public.chat_messages m
				 left join public.clients c on c.id = m.client_id where c.id is null) as orphaned
		`).catch(() => ({ rows: [{}] }));

		let dryRunFn = null;
		try {
			const dr = await client.query('select public.p1e_chat_backfill_dry_run() as report');
			dryRunFn = dr.rows[0]?.report;
		} catch {
			dryRunFn = 'FUNCTION_NOT_PRESENT';
		}

		console.log(JSON.stringify({
			target: PRODUCTION_REF,
			phase: 'BASELINE',
			counts: baseline,
			chat_messages: chatDetail[0],
			duplicate_sequences: dupSeq,
			activities: activitiesDetail[0],
			clients_without_default_activity: noDefault.map((r) => r.id),
			clients_with_multiple_defaults: multiDefault,
			agent_sessions: sessionsDetail[0],
			pre_migration_dry_run_inline: dryRun[0],
			p1e_chat_backfill_dry_run: dryRunFn,
		}, null, 2));
	} finally {
		await client.end();
	}
}

main().catch((err) => {
	console.error(err.message || err);
	process.exit(1);
});
