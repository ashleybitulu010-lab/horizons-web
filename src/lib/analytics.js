/** Google Analytics 4 — Ash Ledger (G-CR01T8LKBT) */

export const GA_MEASUREMENT_ID = 'G-CR01T8LKBT';

const LAST_VISIT_KEY = 'ash_ga_last_visit';
const SESSION_START_KEY = 'ash_ga_session_start';
const TRIAL_FLAG_KEY = 'ash_ga_was_trial';
const CONVERSION_KEY = 'ash_ga_trial_converted';
const DEBUG_KEY = 'ash_ga_debug';

function isBrowser() {
  return typeof window !== 'undefined';
}

/** Persist ?debug_ga=1 so SPA navigations keep DebugView mode. */
function syncDebugFlagFromUrl() {
  if (!isBrowser()) return;
  try {
    if (new URLSearchParams(window.location.search).get('debug_ga') === '1') {
      localStorage.setItem(DEBUG_KEY, '1');
    }
  } catch {
    /* ignore */
  }
}

export function isDebugMode() {
  if (!isBrowser()) return false;
  syncDebugFlagFromUrl();
  try {
    if (new URLSearchParams(window.location.search).get('debug_ga') === '1') return true;
    if (localStorage.getItem(DEBUG_KEY) === '1') return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Ensure dataLayer + gtag exist (script may still be loading). */
export function ensureGtag() {
  if (!isBrowser()) return () => {};
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
  }
  return window.gtag;
}

function debugParams() {
  return isDebugMode() ? { debug_mode: true } : {};
}

/** Merge debug_mode into every config so later calls never wipe it. */
function configGa(extra = {}) {
  const gtag = ensureGtag();
  gtag('config', GA_MEASUREMENT_ID, {
    send_page_view: false,
    ...debugParams(),
    ...extra,
  });
}

let initialized = false;

/**
 * Idempotent GA4 init. Must run BEFORE the first page_view / custom event
 * so DebugView receives hits when ?debug_ga=1 (or ash_ga_debug=1).
 */
export function initAnalytics() {
  if (!isBrowser() || initialized) return;
  syncDebugFlagFromUrl();
  ensureGtag();
  configGa();
  initialized = true;
  trackRetentionVisit();
  startSessionClock();
}

export function setAnalyticsUser(userId) {
  if (!initialized) initAnalytics();
  if (!userId) {
    configGa({ user_id: null });
    return;
  }
  configGa({ user_id: String(userId) });
  ensureGtag()('set', { user_id: String(userId) });
}

export function trackPageView(path, title) {
  if (!initialized) initAnalytics();
  trackEvent('page_view', {
    page_path: path || (isBrowser() ? window.location.pathname + window.location.search : '/'),
    page_title: title || (isBrowser() ? document.title : 'Ash Ledger'),
    page_location: isBrowser() ? window.location.href : undefined,
  });
}

/** Fire a custom event — never throws, never blocks UI. */
export function trackEvent(name, params = {}) {
  try {
    if (!initialized) initAnalytics();
    const gtag = ensureGtag();
    // debug_mode must be on the event itself for DebugView (ep.debug_mode / _dbg).
    gtag('event', name, {
      ...params,
      ...debugParams(),
      send_to: GA_MEASUREMENT_ID,
    });
  } catch {
    /* analytics must never break the app */
  }
}

export function trackSignUp(method = 'email') {
  trackEvent('sign_up', { method });
  trackEvent('free_trial_started', { method });
  try {
    localStorage.setItem(TRIAL_FLAG_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function trackLogin(method = 'email') {
  trackEvent('login', { method });
}

export function trackChatMessageSent(source = 'main_chat') {
  trackEvent('chatbot_message_sent', { source });
}

export function trackSaleAdded(extra = {}) {
  trackEvent('sale_added', extra);
}

export function trackExpenseAdded(extra = {}) {
  trackEvent('expense_added', extra);
}

export function trackReportGenerated(extra = {}) {
  trackEvent('report_generated', extra);
}

export function trackDashboardViewed() {
  trackEvent('dashboard_viewed');
}

export function trackSubscriptionPurchased(extra = {}) {
  trackEvent('subscription_purchased', {
    currency: extra.currency || 'USD',
    value: extra.value ?? 10,
    ...extra,
  });
}

/**
 * Trial → paid conversion (also sent as `conversion` for GA4 custom reporting).
 * Deduped per browser so it fires once.
 */
export function trackTrialConversion(extra = {}) {
  try {
    if (localStorage.getItem(CONVERSION_KEY) === '1') return;
    localStorage.setItem(CONVERSION_KEY, '1');
  } catch {
    /* ignore */
  }
  trackEvent('conversion', {
    conversion_type: 'trial_to_subscription',
    ...extra,
  });
  trackSubscriptionPurchased({
    ...extra,
    conversion_type: 'trial_to_subscription',
  });
}

/** Call when subscription data is known (trial / premium). */
export function syncSubscriptionAnalytics(subscription) {
  if (!subscription) return;
  if (subscription.isTrial) {
    try {
      localStorage.setItem(TRIAL_FLAG_KEY, '1');
    } catch {
      /* ignore */
    }
  }
  if (subscription.isPremiumActive) {
    let wasTrial = false;
    try {
      wasTrial = localStorage.getItem(TRIAL_FLAG_KEY) === '1';
    } catch {
      /* ignore */
    }
    if (wasTrial) {
      trackTrialConversion({ plan: subscription.plan || 'premium' });
    }
  }
}

function trackRetentionVisit() {
  if (!isBrowser()) return;
  const now = Date.now();
  let last = 0;
  try {
    last = Number(localStorage.getItem(LAST_VISIT_KEY) || 0);
  } catch {
    /* ignore */
  }

  if (last > 0) {
    const days = (now - last) / (24 * 60 * 60 * 1000);
    if (days >= 1 && days < 2) {
      trackEvent('retention', { retention_window: 'next_day', days_since_last: Math.round(days * 10) / 10 });
    } else if (days >= 7 && days < 14) {
      trackEvent('retention', { retention_window: 'next_week', days_since_last: Math.round(days * 10) / 10 });
    } else if (days >= 1) {
      trackEvent('retention', { retention_window: 'return_visit', days_since_last: Math.round(days * 10) / 10 });
    }
  }

  try {
    localStorage.setItem(LAST_VISIT_KEY, String(now));
  } catch {
    /* ignore */
  }
}

let sessionTimer = null;

function startSessionClock() {
  if (!isBrowser()) return;
  const started = Date.now();
  try {
    sessionStorage.setItem(SESSION_START_KEY, String(started));
  } catch {
    /* ignore */
  }

  const emit = (reason) => {
    let start = started;
    try {
      start = Number(sessionStorage.getItem(SESSION_START_KEY) || started);
    } catch {
      /* ignore */
    }
    const seconds = Math.max(0, Math.round((Date.now() - start) / 1000));
    if (seconds < 5 && reason !== 'heartbeat') return;
    trackEvent('session_duration', {
      engagement_time_msec: seconds * 1000,
      session_seconds: seconds,
      reason,
    });
  };

  if (sessionTimer) window.clearInterval(sessionTimer);
  sessionTimer = window.setInterval(() => emit('heartbeat'), 60_000);

  const onHide = () => emit('visibility_hidden');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide();
  });
  window.addEventListener('pagehide', onHide);
}

/** Infer business events from Ash bot replies (non-blocking). */
export function trackFromAssistantReply(replyText) {
  const text = String(replyText || '');
  if (!text) return;

  if (/vente[\s\S]{0,80}enregistr/i.test(text) || /💰[\s\S]{0,40}vente/i.test(text)) {
    trackSaleAdded({ source: 'chat_reply' });
  }
  if (/d[ée]pense[\s\S]{0,80}enregistr/i.test(text) || /💸[\s\S]{0,40}d[ée]pense/i.test(text)) {
    trackExpenseAdded({ source: 'chat_reply' });
  }
  if (
    /bilan/i.test(text)
    || /\.pdf/i.test(text)
    || /rapport[\s\S]{0,40}(g[ée]n[ée]r|prêt|disponible)/i.test(text)
  ) {
    trackReportGenerated({ source: 'chat_reply' });
  }
}
