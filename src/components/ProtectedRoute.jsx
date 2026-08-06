import React from 'react';
import { Navigate } from 'react-router-dom';

function isAuthed() {
  try {
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
