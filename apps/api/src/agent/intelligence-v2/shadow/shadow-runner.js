import { getShadowConfig } from '../config.js';
import { SHADOW_STATUS } from './shadow-contract.js';
import { createShadowRunId } from './shadow-run-id.js';

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run shadow diagnostic with dedicated timeout. Never throws.
 */
export async function runShadowWithTimeout(runFn, options = {}) {
	const shadowRunId = createShadowRunId();
	const timeoutMs = options.timeoutMs ?? getShadowConfig(options.env).shadowTimeoutMs;
	const startedAt = Date.now();

	try {
		const result = await Promise.race([
			runFn({ shadowRunId }),
			sleep(timeoutMs).then(() => ({ timedOut: true })),
		]);

		if (result?.timedOut) {
			return {
				shadowRunId,
				status: SHADOW_STATUS.TIMEOUT,
				durationMs: Date.now() - startedAt,
				shadowWritesDetected: 0,
			};
		}

		return {
			...result,
			shadowRunId,
			status: result?.status || SHADOW_STATUS.SUCCESS,
			durationMs: Date.now() - startedAt,
			shadowWritesDetected: result?.shadowWritesDetected ?? 0,
		};
	} catch (err) {
		return {
			shadowRunId,
			status: err?.code === 'SHADOW_WRITE_BLOCKED'
				? SHADOW_STATUS.WRITE_BLOCKED
				: SHADOW_STATUS.ERROR,
			errorCode: err?.code || 'SHADOW_ERROR',
			durationMs: Date.now() - startedAt,
			shadowWritesDetected: 0,
		};
	}
}
