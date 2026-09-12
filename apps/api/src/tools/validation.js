export const FORBIDDEN_IDENTITY_KEYS = Object.freeze([
	'userId',
	'clientId',
	'client_id',
	'activityId',
	'activity_id',
	'user_id',
	'businessUserId',
	'tenantId',
	'tenant_id',
	'pbUserId',
]);

export function assertNoIdentityParams(input = {}, toolName = 'tool') {
	for (const key of FORBIDDEN_IDENTITY_KEYS) {
		if (input[key] != null && input[key] !== '') {
			const error = new Error(`Forbidden parameter for ${toolName}: ${key}`);
			error.code = 'FORBIDDEN_PARAMETER';
			throw error;
		}
	}
	return input;
}
