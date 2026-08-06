import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildDashboardAnalytics } from '@/lib/dashboardAnalytics';
import { createDashboardSession, supabase, supabaseConfigured } from '@/lib/supabaseRest';

const DASHBOARD_TABLES = ['produits', 'stocks', 'ventes', 'depenses'];

const EMPTY_DATA = {
  produits: [],
  stocks: [],
  ventes: [],
  depenses: [],
};

export function useDashboardData(user, authToken) {
  const userId = user?.id;
  const [clientId, setClientId] = useState(null);
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [realtimeStatus, setRealtimeStatus] = useState('connecting');
  const [resolutionAttempt, setResolutionAttempt] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setClientId(null);
    setData(EMPTY_DATA);

    if (!userId) {
      setLoading(false);
      return () => { active = false; };
    }
    if (!supabaseConfigured() || !supabase) {
      setError('La connexion Supabase du tableau de bord n’est pas configurée.');
      setLoading(false);
      return () => { active = false; };
    }
    if (!authToken) {
      setError('Votre session a expiré. Veuillez vous reconnecter.');
      setLoading(false);
      return () => { active = false; };
    }

    createDashboardSession(authToken)
      .then((resolvedId) => {
        if (!active) return;
        if (!resolvedId) {
          setError('Impossible d’ouvrir votre espace Supabase.');
          setLoading(false);
          return;
        }
        setClientId(resolvedId);
      })
      .catch(() => {
        if (!active) return;
        setError('Impossible d’ouvrir votre espace Supabase. Veuillez réessayer.');
        setLoading(false);
      });

    return () => { active = false; };
  }, [userId, authToken, resolutionAttempt]);

  const fetchData = useCallback(async ({ silent = false } = {}) => {
    if (!clientId || !supabase) return;
    const requestId = ++requestIdRef.current;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const results = await Promise.all(
        DASHBOARD_TABLES.map(async (table) => {
          const { data: rows, error: queryError } = await supabase
            .from(table)
            .select('*')
            .eq('client_id', clientId);
          if (queryError) throw queryError;
          return [table, rows || []];
        }),
      );
      if (requestId !== requestIdRef.current) return;
      setData(Object.fromEntries(results));
      setLastUpdated(new Date());
    } catch (queryError) {
      if (requestId !== requestIdRef.current) return;
      setError(queryError?.message || 'Impossible de charger les données du tableau de bord.');
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return undefined;
    fetchData();
    return () => {
      requestIdRef.current += 1;
    };
  }, [clientId, fetchData]);

  useEffect(() => {
    if (!clientId || !supabase) return undefined;

    let refreshTimer;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => fetchData({ silent: true }), 180);
    };

    let channel = supabase.channel(`dashboard-${clientId}`);
    DASHBOARD_TABLES.forEach((table) => {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `client_id=eq.${clientId}`,
        },
        scheduleRefresh,
      );
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') setRealtimeStatus('connected');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRealtimeStatus('error');
      else if (status === 'CLOSED') setRealtimeStatus('disconnected');
      else setRealtimeStatus('connecting');
    });

    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };
    document.addEventListener('visibilitychange', refreshOnFocus);

    return () => {
      window.clearTimeout(refreshTimer);
      document.removeEventListener('visibilitychange', refreshOnFocus);
      supabase.removeChannel(channel);
    };
  }, [clientId, fetchData]);

  const analytics = useMemo(() => buildDashboardAnalytics(data), [data]);

  return {
    ...analytics,
    loading,
    refreshing,
    error,
    lastUpdated,
    realtimeStatus,
    refresh: () => {
      if (clientId) return fetchData({ silent: true });
      setError(null);
      setLoading(true);
      setResolutionAttempt((attempt) => attempt + 1);
      return undefined;
    },
  };
}
