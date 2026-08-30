/**
 * Phase 3.9 — feature flag for create_sale write routing via Ashy.
 * Default OFF: import.meta.env.VITE_ASHY_WRITE_CHAT must be exactly "true".
 */

export function isAshyWriteChatEnabled(env = import.meta.env) {
  return String(env?.VITE_ASHY_WRITE_CHAT || '').toLowerCase() === 'true';
}
