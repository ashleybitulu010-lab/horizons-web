#!/usr/bin/env node
/** H10.1 staging classifier-only check (no writes, no deploy). */
import { createClient } from '@supabase/supabase-js';
import { classifyGoal } from '../apps/api/src/agent/intelligence-v2/goal-classifier.js';

const STAGING_REF = 'vwjkktqcmmhotadicbpg';
const PRODUCTION_REF = 'knrwplidgvuvjnuqqmrt';
const url = process.env.SUPABASE_URL || '';
const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
const ref = match ? match[1].toLowerCase() : null;
if (ref === PRODUCTION_REF) throw new Error('Production blocked');
if (ref !== STAGING_REF) throw new Error(`Expected staging ${STAGING_REF}, got ${ref || url}`);

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: activities } = await sb.from('activities').select('id, client_id').limit(1);
const activity = activities?.[0];
if (!activity) throw new Error('No staging activity');

const [{ count: produits }, { count: stocks }] = await Promise.all([
	sb.from('produits').select('id', { count: 'exact', head: true }).eq('activity_id', activity.id),
	sb.from('stocks').select('*', { count: 'exact', head: true }).eq('activity_id', activity.id),
]);

const refDate = new Date('2026-09-12T12:00:00.000Z');
const cases = [
	{ msg: "J'ai dépensé de l'argent pour le transport.", expect: { type: 'ACTION', domain: 'EXPENSES', objective: 'CREATE' } },
	{ msg: "J'ai vendu 1 poulet à 2 dollars.", expect: { type: 'ACTION', domain: 'SALES', objective: 'CREATE' } },
];
const results = [];
for (const c of cases) {
	const r = await classifyGoal(c.msg, {}, { referenceDate: refDate, forceRules: true });
	const g = r.goal;
	results.push({
		message: c.msg,
		ok: g?.type === c.expect.type && g?.domain === c.expect.domain && g?.objective === c.expect.objective,
		goal: g,
	});
}

console.log(JSON.stringify({
	phase: 'H10.1-staging-classifier',
	ref: STAGING_REF,
	activityId: activity.id,
	produits: produits ?? 0,
	stocks: stocks ?? 0,
	allPass: results.every((x) => x.ok),
	results,
}, null, 2));

process.exit(results.every((x) => x.ok) ? 0 : 1);
