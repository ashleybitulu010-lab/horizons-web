import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
	PRODUCTION_SUPABASE_PROJECT_REF,
	STAGING_GATE_REASONS,
	evaluateStagingHarnessGate,
	parseSupabaseProjectRef,
	stagingGateDiagnostics,
} from './helpers/agent-session-p0-staging-guard.js';

const BASE_ENV = {
	SUPABASE_URL: 'https://staging-project-ref.supabase.co',
	SUPABASE_SERVICE_ROLE_KEY: 'test-key-not-a-real-jwt',
	RUN_STAGING: 'true',
	STAGING_ALLOWED_SUPABASE_PROJECT_REF: 'staging-project-ref',
	NODE_ENV: 'development',
};

describe('Phase 5.8-P0-ENV-2 — staging harness guard', () => {
	test('1. credentials absent → blocked', () => {
		const gate = evaluateStagingHarnessGate({});
		assert.equal(gate.allowed, false);
		assert.equal(gate.reason, STAGING_GATE_REASONS.CREDENTIALS_MISSING);
		assert.equal(gate.diagnostics.serviceRoleKey, 'ABSENT');
	});

	test('2. RUN_STAGING=false → blocked', () => {
		const gate = evaluateStagingHarnessGate({
			...BASE_ENV,
			RUN_STAGING: 'false',
		});
		assert.equal(gate.allowed, false);
		assert.equal(gate.reason, STAGING_GATE_REASONS.RUN_STAGING_NOT_TRUE);
	});

	test('3. allowlist absent → blocked', () => {
		const gate = evaluateStagingHarnessGate({
			...BASE_ENV,
			STAGING_ALLOWED_SUPABASE_PROJECT_REF: '',
		});
		assert.equal(gate.allowed, false);
		assert.equal(gate.reason, STAGING_GATE_REASONS.ALLOWLIST_MISSING);
	});

	test('4. project ref different → blocked', () => {
		const gate = evaluateStagingHarnessGate({
			...BASE_ENV,
			SUPABASE_URL: 'https://other-project.supabase.co',
		});
		assert.equal(gate.allowed, false);
		assert.equal(gate.reason, STAGING_GATE_REASONS.PROJECT_REF_NOT_ALLOWED);
		assert.equal(gate.diagnostics.projectRef, 'other-project');
		assert.equal(gate.diagnostics.allowedProjectRef, 'staging-project-ref');
	});

	test('5. matching project ref + explicit opt-in → allowed', () => {
		const gate = evaluateStagingHarnessGate(BASE_ENV);
		assert.equal(gate.allowed, true);
		assert.equal(gate.reason, STAGING_GATE_REASONS.OK);
	});

	test('6. NODE_ENV=production → blocked even with credentials', () => {
		const gate = evaluateStagingHarnessGate({
			...BASE_ENV,
			NODE_ENV: 'production',
		});
		assert.equal(gate.allowed, false);
		assert.equal(gate.reason, STAGING_GATE_REASONS.NODE_ENV_PRODUCTION);
	});

	test('7. diagnostics never expose secrets', () => {
		const secret = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake-secret-value';
		const diagnostics = stagingGateDiagnostics({
			...BASE_ENV,
			SUPABASE_SERVICE_ROLE_KEY: secret,
		});
		const json = JSON.stringify(diagnostics);
		assert.equal(json.includes(secret), false);
		assert.equal(diagnostics.serviceRoleKey, 'PRESENT');
	});

	test('8. unauthorized URL → gate blocks before any Supabase client would be created', () => {
		let createClientCalled = false;
		const gate = evaluateStagingHarnessGate({
			...BASE_ENV,
			SUPABASE_URL: 'https://production-like-ref.supabase.co',
			STAGING_ALLOWED_SUPABASE_PROJECT_REF: 'staging-only-ref',
		});
		if (gate.allowed) {
			createClientCalled = true;
		}
		assert.equal(gate.allowed, false);
		assert.equal(createClientCalled, false);
	});

	test('9. production project ref URL → blocked even with RUN_STAGING=true', () => {
		const gate = evaluateStagingHarnessGate({
			...BASE_ENV,
			SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
			STAGING_ALLOWED_SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF,
		});
		assert.equal(gate.allowed, false);
		assert.equal(gate.reason, STAGING_GATE_REASONS.PRODUCTION_PROJECT_REF_BLOCKED);
	});

	test('10. production ref in allowlist only → blocked', () => {
		const gate = evaluateStagingHarnessGate({
			...BASE_ENV,
			STAGING_ALLOWED_SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF,
		});
		assert.equal(gate.allowed, false);
		assert.equal(gate.reason, STAGING_GATE_REASONS.PRODUCTION_PROJECT_REF_BLOCKED);
	});

	test('parseSupabaseProjectRef extracts ref from URL', () => {
		assert.equal(
			parseSupabaseProjectRef('https://abc123.supabase.co'),
			'abc123',
		);
		assert.equal(parseSupabaseProjectRef('not-a-url'), null);
	});
});
