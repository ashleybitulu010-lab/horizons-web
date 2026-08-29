/**
 * Phase 3.7 — feature flag for read-only Ashy chat routing.
 * Default OFF: import.meta.env.VITE_ASHY_READ_CHAT must be exactly "true".
 */

export function isAshyReadChatEnabled(env = import.meta.env) {
  return String(env?.VITE_ASHY_READ_CHAT || '').toLowerCase() === 'true';
}
