import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  initAnalytics,
  setAnalyticsUser,
  trackPageView,
} from '@/lib/analytics';
import { useAuth } from '@/hooks/useAuth';

/**
 * Loads/configures GA4 once, tracks SPA page_view on every route change,
 * and binds the authenticated user id for retention reports.
 */
export default function AnalyticsProvider({ children }) {
  const location = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    // Defer config until idle so first paint stays snappy.
    const run = () => initAnalytics();
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 2000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(run, 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    setAnalyticsUser(user?.id || null);
  }, [user?.id]);

  useEffect(() => {
    // Slight delay so Helmet / page titles settle after navigation.
    const t = window.setTimeout(() => {
      trackPageView(location.pathname + location.search, document.title);
    }, 0);
    return () => window.clearTimeout(t);
  }, [location.pathname, location.search]);

  return children;
}
