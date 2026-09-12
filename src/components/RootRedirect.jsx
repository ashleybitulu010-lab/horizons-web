import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import WelcomePage from '@/pages/WelcomePage';

export default function RootRedirect() {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Navigate to="/chat" replace />;
  }

  return <WelcomePage />;
}
