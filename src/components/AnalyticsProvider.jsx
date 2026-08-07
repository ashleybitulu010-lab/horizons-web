import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  initAnalytics,
  setAnalyticsUser,
  trackPageView,
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

  useEffect(() => {
    // Synchronous init — do not idle-defer: page_view must follow debug_mode config.
    initAnalytics();
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

  return children;
}
