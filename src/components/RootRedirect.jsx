import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export default function RootRedirect() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div
        className="min-h-[100dvh] flex flex-col items-center justify-center gap-3"
        style={{ backgroundColor: '#F5F1EB' }}
      >
        <div
          className="w-10 h-10 rounded-full border-2 animate-spin"
          style={{ borderColor: '#FF6B00', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  return <Navigate to={isAuthenticated ? '/chat' : '/login'} replace />;
}
