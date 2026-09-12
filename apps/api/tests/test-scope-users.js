/** Shared scoped user fixtures for unit tests (no DB required). */
export const DEFAULT_ACTIVITY_ID = 'activity_a';
export const OTHER_ACTIVITY_ID = 'activity_b';

export function withActivityScope(user, activityId = DEFAULT_ACTIVITY_ID) {
	return {
		...user,
		activeActivityId: activityId,
	};
}
