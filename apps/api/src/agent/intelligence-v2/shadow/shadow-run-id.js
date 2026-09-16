import { randomUUID } from 'node:crypto';

/**
 * Backend-only identifier for one shadow observation run.
 */
export function createShadowRunId() {
	return `shadow-${randomUUID()}`;
}
