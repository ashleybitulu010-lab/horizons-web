/**
 * Future write tools must follow this policy (Phase 2.1 contract only).
 * No write tools are executed in this phase.
 */
export const WRITE_TOOL_POLICY = Object.freeze({
	requiresAuthenticatedUser: true,
	requiresConfirmation: true,
	requiresSupabaseSuccess: true,
	identityFromBackendContextOnly: true,
	neverConfirmWithoutSupabaseResponse: true,
});

export function assertWriteToolPolicy(definition) {
	if (definition.access !== 'write') return true;
	return definition.requiresConfirmation === true
		&& definition.mutatesData === true
		&& definition.sourceOfTruth === 'supabase';
}
