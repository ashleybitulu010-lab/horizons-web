import React from 'react';
import { Route, Routes, BrowserRouter as Router, Navigate } from 'react-router-dom';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute, { GuestOnlyRoute } from './components/ProtectedRoute';
import RootRedirect from './components/RootRedirect';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ChatPage from './pages/ChatPage';
import ProfilePage from './pages/ProfilePage';
import SubscriptionPage from './pages/SubscriptionPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import DashboardPage from './pages/DashboardPage';
import { ChatProvider } from '@/context/ChatContext';
import { AuthProvider } from '@/hooks/useAuth';
import AnalyticsProvider from '@/components/AnalyticsProvider';

function App() {
  return (
    <Router>
      <ScrollToTop />
      <AuthProvider>
        <AnalyticsProvider>
          <ChatProvider>
            <Routes>
              <Route path="/" element={<RootRedirect />} />
              <Route path="/login" element={<GuestOnlyRoute><LoginPage /></GuestOnlyRoute>} />
              <Route path="/signup" element={<GuestOnlyRoute><SignupPage /></GuestOnlyRoute>} />
              <Route path="/forgot-password" element={<GuestOnlyRoute><ForgotPasswordPage /></GuestOnlyRoute>} />
              <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
              <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
              <Route path="/subscription" element={<ProtectedRoute><SubscriptionPage /></ProtectedRoute>} />
              <Route path="/reports" element={<ProtectedRoute><ReportsPage /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
              <Route path="*" element={<RootRedirect />} />
            </Routes>
          </ChatProvider>
        </AnalyticsProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
