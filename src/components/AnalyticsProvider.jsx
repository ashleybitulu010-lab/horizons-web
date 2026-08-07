import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  initAnalytics,
  setAnalyticsUser,
  trackPageView,
  verifyBusinessEventsOnce,
  exposeDebugAnalytics,
} from '@/lib/analytics';
import { useAuth } from '@/hooks/useAuth';

/**
 * Configures GA4 immediately (before first paint events), tracks SPA page_view
 * on every route change, and binds the authenticated user id for retention.
 */
export default function AnalyticsProvider({ children }) {
  const location = useLocation();
  const { user } = useAuth();
  const ready = useRef(false);
  const verified = useRef(false);

  useEffect(() => {
    // Synchronous init — do not idle-defer: page_view must follow debug_mode config.
    initAnalytics();
    exposeDebugAnalytics();
    ready.current = true;
  }, []);

  useEffect(() => {
    setAnalyticsUser(user?.id || null);
  }, [user?.id]);

  useEffect(() => {
    if (!ready.current) initAnalytics();
    const t = window.setTimeout(() => {
      trackPageView(location.pathname + location.search, document.title);
    }, 0);
    return () => window.clearTimeout(t);
  }, [location.pathname, location.search]);

  // QA: ?debug_ga=1&verify_events=1 fires each business event once for DebugView.
  useEffect(() => {
    if (verified.current) return;
    try {
      const params = new URLSearchParams(location.search);
      if (params.get('debug_ga') !== '1' || params.get('verify_events') !== '1') return;
      verified.current = true;
      const t = window.setTimeout(() => {
        verifyBusinessEventsOnce('verify_events');
      }, 800);
      return () => window.clearTimeout(t);
    } catch {
      /* ignore */
    }
  }, [location.search]);

  return children;
}
