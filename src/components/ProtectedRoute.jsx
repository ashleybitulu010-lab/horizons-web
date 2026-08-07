import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

function AuthSplash() {
  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center gap-3"
      style={{ backgroundColor: '#F5F1EB' }}
    >
      <div
        className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: '#FF6B00', borderTopColor: 'transparent' }}
      />
      <p className="text-sm font-medium text-stone-500">Ouverture de votre session…</p>
    </div>
  );
}

/** Protect private routes — wait for session restore before deciding. */
export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <AuthSplash />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

/** Public auth screens — skip login when already signed in. */
export function GuestOnlyRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <AuthSplash />;
  if (isAuthenticated) return <Navigate to="/chat" replace />;
  return children;
}
