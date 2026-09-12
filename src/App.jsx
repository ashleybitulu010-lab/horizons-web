import React from 'react';
import { Route, Routes, BrowserRouter as Router, Navigate } from 'react-router-dom';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute, { GuestOnlyRoute, SetupOnlyRoute, SetupRequiredRoute } from './components/ProtectedRoute';
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
import WelcomePage from './pages/WelcomePage';
import PostSignupWelcomePage from './pages/PostSignupWelcomePage';
import IntroGuidePage from './pages/IntroGuidePage';
import SetupActivityPage from './pages/SetupActivityPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import { ChatProvider } from '@/context/ChatContext';
import { LanguageProvider } from '@/context/LanguageContext';
import { AuthProvider } from '@/hooks/useAuth';
import AnalyticsProvider from '@/components/AnalyticsProvider';
import StartupGate from '@/components/StartupGate';

function App() {
  return (
    <Router>
      <ScrollToTop />
      <AuthProvider>
        <StartupGate>
          <LanguageProvider>
            <AnalyticsProvider>
              <ChatProvider>
                <Routes>
                <Route path="/" element={<RootRedirect />} />
                <Route path="/welcome" element={<GuestOnlyRoute><WelcomePage /></GuestOnlyRoute>} />
                <Route path="/login" element={<GuestOnlyRoute><LoginPage /></GuestOnlyRoute>} />
                <Route path="/signup" element={<GuestOnlyRoute><SignupPage /></GuestOnlyRoute>} />
                <Route path="/forgot-password" element={<GuestOnlyRoute><ForgotPasswordPage /></GuestOnlyRoute>} />
                <Route path="/reset-password" element={<GuestOnlyRoute><ResetPasswordPage /></GuestOnlyRoute>} />
                <Route path="/start" element={<ProtectedRoute><PostSignupWelcomePage /></ProtectedRoute>} />
                <Route path="/guide" element={<ProtectedRoute><IntroGuidePage /></ProtectedRoute>} />
                <Route path="/setup" element={<SetupOnlyRoute><SetupActivityPage /></SetupOnlyRoute>} />
                <Route path="/chat" element={<SetupRequiredRoute><ChatPage /></SetupRequiredRoute>} />
                <Route path="/dashboard" element={<SetupRequiredRoute><DashboardPage /></SetupRequiredRoute>} />
                <Route path="/profile" element={<SetupRequiredRoute><ProfilePage /></SetupRequiredRoute>} />
                <Route path="/subscription" element={<SetupRequiredRoute><SubscriptionPage /></SetupRequiredRoute>} />
                <Route path="/reports" element={<SetupRequiredRoute><ReportsPage /></SetupRequiredRoute>} />
                <Route path="/settings" element={<SetupRequiredRoute><SettingsPage /></SetupRequiredRoute>} />
                <Route path="*" element={<RootRedirect />} />
              </Routes>
            </ChatProvider>
          </AnalyticsProvider>
        </LanguageProvider>
        </StartupGate>
      </AuthProvider>
    </Router>
  );
}

export default App;
