import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildDashboardAnalytics } from '@/lib/dashboardAnalytics';
import { DEFAULT_CURRENCY_SETTINGS, normalizeCurrencySettings } from '@/lib/currency';
import { createDashboardSession, supabase, supabaseConfigured } from '@/lib/supabaseRest';

const DASHBOARD_TABLES = [
  'produits',
  'stocks',
  'ventes',
  'depenses',
  'paiements_dettes',
  'synthese_mensuelle',
];

/** Real tables only — synthese_mensuelle is a view (no postgres_changes). */
const REALTIME_TABLES = [
  'produits',
  'stocks',
  'ventes',
  'depenses',
  'paiements_dettes',
];

const EMPTY_DATA = {
  produits: [],
  stocks: [],
  ventes: [],
  depenses: [],
  paiements_dettes: [],
  synthese_mensuelle: [],
};

function rowKey(table, row) {
  return table === 'stocks' ? row?.numero : row?.id;
}

function applyRealtimeChange(currentData, table, payload) {
  const rows = currentData[table] || [];
  const eventType = payload.eventType;
  const record = eventType === 'DELETE' ? payload.old : payload.new;
  const key = rowKey(table, record);
  if (key === undefined || key === null) return currentData;

  if (eventType === 'DELETE') {
    return {
      ...currentData,
      [table]: rows.filter((row) => rowKey(table, row) !== key),
    };
  }

  const existingIndex = rows.findIndex((row) => rowKey(table, row) === key);
  if (existingIndex === -1) {
    return {
      ...currentData,
      [table]: [...rows, record],
    };
  }

  const nextRows = rows.slice();
  nextRows[existingIndex] = { ...nextRows[existingIndex], ...record };
  return {
    ...currentData,
    [table]: nextRows,
  };
}

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
  const [currencySettings, setCurrencySettings] = useState(DEFAULT_CURRENCY_SETTINGS);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setClientId(null);
    setData(EMPTY_DATA);
    setCurrencySettings(DEFAULT_CURRENCY_SETTINGS);

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
      const { data: snapshot, error: snapshotError } = await supabase
        .rpc('get_dashboard_snapshot');
      if (snapshotError) throw snapshotError;
      if (requestId !== requestIdRef.current) return;
      setData(Object.fromEntries(
        DASHBOARD_TABLES.map((table) => [
          table,
          Array.isArray(snapshot?.[table]) ? snapshot[table] : [],
        ]),
      ));
      setCurrencySettings(normalizeCurrencySettings(snapshot?.client));
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
      refreshTimer = window.setTimeout(() => fetchData({ silent: true }), 100);
    };

    let channel = supabase.channel(`dashboard-${clientId}`);
    REALTIME_TABLES.forEach((table) => {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `client_id=eq.${clientId}`,
        },
        (payload) => {
          setData((currentData) => applyRealtimeChange(currentData, table, payload));
          setLastUpdated(new Date());
          scheduleRefresh();
        },
      );
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setRealtimeStatus('connected');
        // Close the gap between the initial fetch and channel subscription.
        scheduleRefresh();
      }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRealtimeStatus('error');
      else if (status === 'CLOSED') setRealtimeStatus('disconnected');
      else setRealtimeStatus('connecting');
    });

    const refreshWhenActive = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };
    const fallbackRefresh = window.setInterval(scheduleRefresh, 15_000);
    document.addEventListener('visibilitychange', refreshWhenActive);
    window.addEventListener('focus', refreshWhenActive);
    window.addEventListener('online', refreshWhenActive);

    return () => {
      window.clearTimeout(refreshTimer);
      window.clearInterval(fallbackRefresh);
      document.removeEventListener('visibilitychange', refreshWhenActive);
      window.removeEventListener('focus', refreshWhenActive);
      window.removeEventListener('online', refreshWhenActive);
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
    currencySettings,
    refresh: () => {
      if (clientId) return fetchData({ silent: true });
      setError(null);
      setLoading(true);
      setResolutionAttempt((attempt) => attempt + 1);
      return undefined;
    },
  };
}
