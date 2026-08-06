import React from 'react';
import { Navigate } from 'react-router-dom';
import pb from '@/lib/pocketbaseClient';

function isAuthed() {
  try {
    if (pb.authStore.isValid && (pb.authStore.record || pb.authStore.model)) {
      return true;
    }
    // Legacy fallback used by older builds
    return !!localStorage.getItem('ash_session');
  } catch {
    return false;
  }
}

export default function ProtectedRoute({ children }) {
  if (!isAuthed()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
