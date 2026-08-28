/**
 * Ashy ↔ Supabase contract (see docs/architecture/ashy-backend-architecture.md)
 */
export const ASHY_SUPABASE_CONTRACT = Object.freeze({
	supabaseIsBusinessTruth: true,
	conversationMemoryIsNotFinancialTruth: true,
	writesRequireSupabaseConfirmation: true,
	neverReportSuccessOnSupabaseError: true,
});

export function assertAshyContract() {
	return { ...ASHY_SUPABASE_CONTRACT };
}
