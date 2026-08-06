import { useEffect, useMemo, useState, useCallback } from 'react';
import pb from '@/lib/pocketbaseClient';
import { writeOnboardingState, defaultOnboardingState } from '@/hooks/useOnboarding';

function getRecord() {
  return pb.authStore.record ?? pb.authStore.model ?? null;
}

function mapUser(record) {
  if (!record) return null;
  const firstName = record.firstName || '';
  const lastName = record.lastName || '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return {
    id: record.id,
    email: record.email,
    firstName,
    lastName,
    name: fullName || record.email?.split('@')[0] || 'Utilisateur',
    created: record.created,
    airtableId: record.airtableId || record.airtable_id || null,
  };
}

function persistSession(record, token) {
  try {
    if (record && token) {
      localStorage.setItem(
        'ash_session',
        JSON.stringify({
          id: record.id,
          email: record.email,
          token,
          at: Date.now(),
        }),
      );
    } else {
      localStorage.removeItem('ash_session');
    }
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }) {
  return children;
}

export function useAuth() {
  const [user, setUser] = useState(() => {
    const rec = getRecord();
    return pb.authStore.isValid && rec ? mapUser(rec) : null;
  });
  const [token, setToken] = useState(() => pb.authStore.token || null);

  useEffect(() => {
    const sync = () => {
      const rec = getRecord();
      const valid = pb.authStore.isValid && rec;
      setUser(valid ? mapUser(rec) : null);
      setToken(valid ? pb.authStore.token || null : null);
      persistSession(valid ? rec : null, valid ? pb.authStore.token : null);
    };
    sync();
    return pb.authStore.onChange((_token, record) => {
      const valid = Boolean(_token && record);
      setUser(valid ? mapUser(record) : null);
      setToken(valid ? _token : null);
      persistSession(valid ? record : null, valid ? _token : null);
    });
  }, []);

  const login = useCallback(async (email, password) => {
    try {
      const authData = await pb.collection('users').authWithPassword(
        email.trim().toLowerCase(),
        password,
      );
      persistSession(authData.record, authData.token);
      return mapUser(authData.record);
    } catch (err) {
      throw new Error(err?.status === 400 ? 'Email ou mot de passe incorrect.' : (err?.message || 'Erreur de connexion'));
    }
  }, []);

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
    persistSession(authData.record, authData.token);
    if (authData.record?.id) {
      writeOnboardingState(authData.record.id, {
        ...defaultOnboardingState(new Date().toISOString()),
        status: 'pending',
      });
    }
    return mapUser(authData.record);
  }, []);

  const logout = useCallback(() => {
    pb.authStore.clear();
    persistSession(null, null);
  }, []);

  return useMemo(() => ({
    user,
    token,
    loading: false,
    login,
    signup,
    logout,
    isAuthenticated: Boolean(user),
  }), [user, token, login, signup, logout]);
}
