import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { isPostSignup } from '@/lib/postSignup';
import { loadActivityConfig } from '@/lib/activityConfig';

/** Protect private routes — session is resolved by StartupGate before first paint. */
export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

/** Public auth screens — skip login when already signed in. */
export function GuestOnlyRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return null;
  if (isAuthenticated) {
    window.location.replace(isPostSignup() ? '/start' : '/chat');
    return null;
  }
  return children;
}

/** Routes that require completed activity setup (chat, dashboard, etc.). */
export function SetupRequiredRoute({ children }) {
  const { isAuthenticated, loading, token } = useAuth();
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    if (loading || !isAuthenticated || !token) return;
    let cancelled = false;

    (async () => {
      try {
        const config = await loadActivityConfig(token);
        if (!cancelled) setNeedsSetup(!config.configurationCompleted);
      } catch {
        if (!cancelled) setNeedsSetup(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, isAuthenticated, token]);

  if (loading || checking) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  return children;
}

/** Setup wizard — redirect to chat when already configured. */
export function SetupOnlyRoute({ children }) {
  const { isAuthenticated, loading, token } = useAuth();
  const [checking, setChecking] = useState(true);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (loading || !isAuthenticated || !token) return;
    let cancelled = false;

    (async () => {
      try {
        const config = await loadActivityConfig(token);
        if (!cancelled) setCompleted(Boolean(config.configurationCompleted));
      } catch {
        if (!cancelled) setCompleted(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, isAuthenticated, token]);

  if (loading || checking) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (completed) return <Navigate to="/chat" replace />;
  return children;
}
