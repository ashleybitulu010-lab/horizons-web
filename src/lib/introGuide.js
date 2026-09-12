const STORAGE_PREFIX = 'ash_intro_guide_v1_';

function storageKey(userId) {
  return userId ? `${STORAGE_PREFIX}${userId}` : null;
}

export function isIntroGuideCompleted(userId) {
  const key = storageKey(userId);
  if (!key) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed?.status === 'completed' || parsed?.status === 'skipped';
  } catch {
    return false;
  }
}

export function markIntroGuideCompleted(userId, skipped = false) {
  const key = storageKey(userId);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      status: skipped ? 'skipped' : 'completed',
      completedAt: new Date().toISOString(),
    }));
  } catch {
    /* ignore */
  }
}
