import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import pb from '@/lib/pocketbaseClient';
import {
  clearDashboardSession,
  createDashboardSession,
  supabase,
} from '@/lib/supabaseRest';
import {
  writeOnboardingState,
  defaultOnboardingState,
  readOnboardingState,
} from '@/hooks/useOnboarding';
import { cleanUtf8Text } from '@/lib/textEncoding';
import { setAnalyticsUser, trackLogin, trackSignUp } from '@/lib/analytics';

const AuthContext = createContext(null);
const ASH_SESSION_KEY = 'ash_session';

function getRecord() {
  return pb.authStore.record ?? pb.authStore.model ?? null;
}

function mapUser(record) {
  if (!record) return null;
  const firstName = cleanUtf8Text(record.firstName || '');
  const lastName = cleanUtf8Text(record.lastName || '');
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  let avatarUrl = null;
  try {
    if (record.avatar) avatarUrl = pb.files.getURL(record, record.avatar);
  } catch {
    avatarUrl = null;
  }
  return {
    id: record.id,
    email: record.email,
    firstName,
    lastName,
    name: fullName || record.email?.split('@')[0] || 'Utilisateur',
    created: record.created,
    airtableId: record.airtableId || record.airtable_id || null,
    avatar: record.avatar || null,
    avatarUrl,
  };
}

function persistLegacySession(record, token) {
  try {
    if (record && token) {
      localStorage.setItem(
        ASH_SESSION_KEY,
        JSON.stringify({
          id: record.id,
          email: record.email,
          token,
          at: Date.now(),
          rememberMe: true,
        }),
      );
    } else {
      localStorage.removeItem(ASH_SESSION_KEY);
    }
  } catch {
    /* ignore */
  }
}

async function refreshPocketBaseSession() {
  if (!pb.authStore.token) return false;
  try {
    await pb.collection('users').authRefresh();
    return Boolean(pb.authStore.isValid && getRecord());
  } catch {
    return false;
  }
}

async function warmSupabaseSession(pocketBaseToken) {
  if (!pocketBaseToken) return;
  try {
    await createDashboardSession(pocketBaseToken);
  } catch {
    /* dashboard features will retry later */
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const bootstrapped = useRef(false);

  const syncFromStore = useCallback((record, authToken) => {
    const valid = Boolean(authToken && record && pb.authStore.isValid);
    const nextUser = valid ? mapUser(record) : null;
    const nextToken = valid ? authToken : null;
    setUser(nextUser);
    setToken(nextToken);
    persistLegacySession(valid ? record : null, nextToken);
    return valid;
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      // PocketBase already hydrates authStore from localStorage on construct.
      if (pb.authStore.token) {
        const refreshed = await refreshPocketBaseSession();
        if (!refreshed && !pb.authStore.isValid) {
          pb.authStore.clear();
          persistLegacySession(null, null);
          await clearDashboardSession();
        }
      }

      const record = getRecord();
      const authToken = pb.authStore.token || null;
      const ok = syncFromStore(record, authToken);
      if (ok && authToken) {
        await warmSupabaseSession(authToken);
      }
    } finally {
      setLoading(false);
      bootstrapped.current = true;
    }
  }, [syncFromStore]);

  useEffect(() => {
    void bootstrap();

    const unsub = pb.authStore.onChange((authToken, record) => {
      const ok = syncFromStore(record, authToken);
      if (!ok) {
        void clearDashboardSession();
      }
    });

    // Keep long-lived sessions warm (WhatsApp-style).
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!pb.authStore.token) return;
      void (async () => {
        const ok = await refreshPocketBaseSession();
        if (ok) {
          syncFromStore(getRecord(), pb.authStore.token);
          await warmSupabaseSession(pb.authStore.token);
        } else if (!pb.authStore.isValid) {
          pb.authStore.clear();
          persistLegacySession(null, null);
          await clearDashboardSession();
          setUser(null);
          setToken(null);
        }
      })();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    const refreshTimer = window.setInterval(() => {
      if (!pb.authStore.token) return;
      void refreshPocketBaseSession().then((ok) => {
        if (ok) syncFromStore(getRecord(), pb.authStore.token);
      });
      if (supabase) {
        void supabase.auth.getSession().then(({ data }) => {
          if (data.session) void supabase.auth.refreshSession().catch(() => {});
        });
      }
    }, 12 * 60 * 1000);

    return () => {
      unsub?.();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(refreshTimer);
    };
  }, [bootstrap, syncFromStore]);

  const login = useCallback(async (email, password) => {
    try {
      const authData = await pb.collection('users').authWithPassword(
        email.trim().toLowerCase(),
        password,
      );
      syncFromStore(authData.record, authData.token);
      await warmSupabaseSession(authData.token);
      if (authData.record?.id && !readOnboardingState(authData.record.id)) {
        writeOnboardingState(authData.record.id, {
          ...defaultOnboardingState(authData.record.created || new Date().toISOString()),
          status: 'pending',
        });
      }
      setAnalyticsUser(authData.record?.id);
      trackLogin('email');
      return mapUser(authData.record);
    } catch (err) {
      throw new Error(
        err?.status === 400
          ? 'Email ou mot de passe incorrect.'
          : (err?.message || 'Erreur de connexion'),
      );
    }
  }, [syncFromStore]);

  const signup = useCallback(async (email, firstName, lastName, password) => {
    await pb.collection('users').create({
      email: email.trim().toLowerCase(),
      password,
      passwordConfirm: password,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
    });
    const authData = await pb.collection('users').authWithPassword(
      email.trim().toLowerCase(),
      password,
    );
    syncFromStore(authData.record, authData.token);
    await warmSupabaseSession(authData.token);
    if (authData.record?.id) {
      writeOnboardingState(authData.record.id, {
        ...defaultOnboardingState(new Date().toISOString()),
        status: 'pending',
      });
    }
    setAnalyticsUser(authData.record?.id);
    trackSignUp('email');
    return mapUser(authData.record);
  }, [syncFromStore]);

  const logout = useCallback(async () => {
    pb.authStore.clear();
    persistLegacySession(null, null);
    await clearDashboardSession();
    setAnalyticsUser(null);
    setUser(null);
    setToken(null);
  }, []);

  /** Keep menu / auth avatar in sync after profile photo updates. */
  const updateUserRecord = useCallback((record) => {
    if (!record || !pb.authStore.token) return mapUser(record);
    pb.authStore.save(pb.authStore.token, record);
    return syncFromStore(record, pb.authStore.token);
  }, [syncFromStore]);

  const value = useMemo(() => ({
    user,
    token,
    loading,
    login,
    signup,
    logout,
    updateUserRecord,
    isAuthenticated: Boolean(user && token),
    refreshSession: bootstrap,
  }), [user, token, loading, login, signup, logout, updateUserRecord, bootstrap]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
