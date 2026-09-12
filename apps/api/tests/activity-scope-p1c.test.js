/**
 * P1-C — activity_id scope on business tables (integration).
 * Requires SUPABASE_DB_URL or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY with P1-C migration applied.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

const DB_URL = process.env.SUPABASE_DB_URL || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RUN = Boolean(
	DB_URL
	|| (process.env.SUPABASE_DB_HOST && process.env.SUPABASE_DB_PASSWORD)
	|| (SUPABASE_URL && SERVICE_KEY),
);
const TAG = `p1c-${Date.now()}`;

/** @type {import('pg').Client} */
let pg;

async function connectPg() {
	const { Client } = await import('pg');
	if (DB_URL) {
		pg = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
		await pg.connect();
		return;
	}
	const urlMatch = SUPABASE_URL.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
	const ref = urlMatch ? urlMatch[1].toLowerCase() : null;
	const host = process.env.SUPABASE_DB_HOST;
	const password = process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASS;
	if (host && password && ref) {
		const user = /pooler\.supabase\.com/i.test(host) ? `postgres.${ref}` : 'postgres';
		pg = new Client({
			host,
			port: Number(process.env.SUPABASE_DB_PORT || 5432),
			user,
			password,
			database: 'postgres',
			ssl: { rejectUnauthorized: false },
		});
		await pg.connect();
		return;
	}
	throw new Error('SUPABASE_DB_URL or SUPABASE_DB_HOST + password required for P1-C tests');
}

async function tableHasActivityId(table) {
	const { rows } = await pg.query(
		`select 1 from information_schema.columns
     where table_schema = 'public' and table_name = $1 and column_name = 'activity_id'`,
		[table],
	);
	return rows.length > 0;
}

async function createFixture() {
	const clientId = randomUUID();
	await pg.query(
		`insert into public.clients (id, user_id, nom_client)
     values ($1, $2, $3)`,
		[clientId, `${TAG}-user`, `${TAG} Client`],
	);
	const { rows: actRows } = await pg.query(
		`insert into public.activities (client_id, name, type, is_default)
     values ($1, $2, 'commerce', true)
     returning id`,
		[clientId, `${TAG} Activity`],
	);
	const activityId = actRows[0].id;

	const otherClientId = randomUUID();
	await pg.query(
		`insert into public.clients (id, user_id, nom_client)
     values ($1, $2, $3)`,
		[otherClientId, `${TAG}-other`, `${TAG} Other`],
	);
	const { rows: otherAct } = await pg.query(
		`insert into public.activities (client_id, name, type, is_default)
     values ($1, $2, 'commerce', true)
     returning id`,
		[otherClientId, `${TAG} Other Activity`],
	);

	return {
		clientId,
		activityId,
		otherClientId,
		otherActivityId: otherAct[0].id,
	};
}

async function cleanup(ids) {
	await pg.query('delete from public.depenses where client_id = any($1::uuid[])', [ids.clientIds]);
	await pg.query('delete from public.produits where client_id = any($1::uuid[])', [ids.clientIds]);
	await pg.query('delete from public.activities where client_id = any($1::uuid[])', [ids.clientIds]);
	await pg.query('delete from public.clients where id = any($1::uuid[])', [ids.clientIds]);
}

describe('P1-C activity scope', () => {
	before(async () => {
		if (!RUN) return;
		await connectPg();
		const ready = await tableHasActivityId('depenses');
		if (!ready) {
			throw new Error('P1-C migration not applied — activity_id missing on depenses');
		}
	});

	after(async () => {
		if (pg) await pg.end();
	});

	test('schema: activity_id NOT NULL + composite FK on business tables', async (t) => {
		if (!RUN) {
			t.skip('SUPABASE_DB_URL required');
			return;
		}
		for (const table of ['ventes', 'depenses', 'produits', 'stocks', 'paiements_dettes']) {
			const { rows: col } = await pg.query(
				`select is_nullable from information_schema.columns
         where table_schema='public' and table_name=$1 and column_name='activity_id'`,
				[table],
			);
			assert.equal(col[0]?.is_nullable, 'NO', `${table}.activity_id should be NOT NULL`);

			const { rows: cons } = await pg.query(
				`select conname from pg_constraint
         where conrelid = $1::regclass and conname = $2`,
				[`public.${table}`, `${table}_client_activity_fkey`],
			);
			assert.ok(cons.length, `${table}_client_activity_fkey missing`);
		}
	});

	test('insert succeeds when activity belongs to client', async (t) => {
		if (!RUN) {
			t.skip('SUPABASE_DB_URL required');
			return;
		}
		const fx = await createFixture();
		try {
			const { rows } = await pg.query(
				`insert into public.depenses (client_id, activity_id, libelle_depense, montant_depense)
         values ($1, $2, $3, 10)
         returning id, client_id, activity_id`,
				[fx.clientId, fx.activityId, `${TAG} expense ok`],
			);
			assert.equal(rows[0].client_id, fx.clientId);
			assert.equal(rows[0].activity_id, fx.activityId);
		} finally {
			await cleanup({ clientIds: [fx.clientId, fx.otherClientId] });
		}
	});

	test('insert fails when activity belongs to another client', async (t) => {
		if (!RUN) {
			t.skip('SUPABASE_DB_URL required');
			return;
		}
		const fx = await createFixture();
		try {
			await assert.rejects(
				() => pg.query(
					`insert into public.produits (client_id, activity_id, nom_produit)
           values ($1, $2, $3)`,
					[fx.clientId, fx.otherActivityId, `${TAG} bad product`],
				),
				/foreign key|violates|client_activity/i,
			);
		} finally {
			await cleanup({ clientIds: [fx.clientId, fx.otherClientId] });
		}
	});

	test('insert fails without activity_id after NOT NULL', async (t) => {
		if (!RUN) {
			t.skip('SUPABASE_DB_URL required');
			return;
		}
		const fx = await createFixture();
		try {
			await assert.rejects(
				() => pg.query(
					`insert into public.depenses (client_id, libelle_depense, montant_depense)
           values ($1, $2, 5)`,
					[fx.clientId, `${TAG} no activity`],
				),
				/not-null|null value/i,
			);
		} finally {
			await cleanup({ clientIds: [fx.clientId, fx.otherClientId] });
		}
	});

	test('each client has exactly one default activity', async (t) => {
		if (!RUN) {
			t.skip('SUPABASE_DB_URL required');
			return;
		}
		const { rows } = await pg.query(`
      select c.id,
             count(a.id)::int as n,
             count(a.id) filter (where a.is_default)::int as defaults
      from public.clients c
      left join public.activities a on a.client_id = c.id
      group by c.id
      having count(a.id) filter (where a.is_default) <> 1
         or count(a.id) = 0
    `);
		assert.equal(rows.length, 0, `clients without exactly one default: ${rows.length}`);
	});

	test('existing depenses/produits preserve business fields after backfill', async (t) => {
		if (!RUN) {
			t.skip('SUPABASE_DB_URL required');
			return;
		}
		const { rows: dep } = await pg.query(`
      select d.id, d.client_id, d.activity_id, d.libelle_depense, d.montant_depense,
             a.client_id as act_client
      from public.depenses d
      join public.activities a on a.id = d.activity_id
    `);
		for (const row of dep) {
			assert.equal(row.client_id, row.act_client);
			assert.ok(row.libelle_depense);
			assert.ok(Number(row.montant_depense) >= 0);
		}
	});
});
