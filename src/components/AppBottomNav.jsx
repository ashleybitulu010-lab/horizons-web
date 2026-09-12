import { useLocation, useNavigate } from 'react-router-dom';
import { BarChart2, LayoutDashboard, Plus, User } from 'lucide-react';
import { BRAND } from '@/lib/brandAssets';

const TABS = [
  { id: 'ashy', label: 'Ashy', to: '/chat', icon: AshyTabIcon },
  { id: 'overview', label: "Vue d'ensemble", to: '/dashboard', icon: LayoutDashboard },
  { id: 'add', label: 'Ajouter', action: 'add' },
  { id: 'reports', label: 'Rapports', to: '/reports', icon: BarChart2 },
  { id: 'profile', label: 'Profil', to: '/profile', icon: User },
];

function AshyTabIcon({ size = 20, strokeWidth = 2, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M5 16l-2 4 5-2h9a4 4 0 004-4V8a4 4 0 00-4-4H8a4 4 0 00-4 4v8z"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function openQuickAdd(navigate, pathname) {
  if (pathname === '/chat' || pathname === '/dashboard') {
    window.dispatchEvent(new CustomEvent('ash:open-quick-add'));
    return;
  }
  navigate('/chat', { state: { openQuickAdd: true } });
}

export function goChatWithDraft(navigate, draft, options = {}) {
  navigate('/chat', { state: { draft, send: Boolean(options.send) } });
}

export default function AppBottomNav({ hidden = false }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  if (hidden) return null;

  return (
    <nav
      className="lg:hidden flex-shrink-0 border-t bg-white"
      style={{
        borderColor: 'rgba(23, 32, 51, 0.06)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        boxShadow: '0 -4px 18px rgba(23, 59, 115, 0.05)',
      }}
      aria-label="Navigation principale"
    >
      <div className="grid grid-cols-5 items-end px-1 pt-1">
        {TABS.map((tab) => {
          if (tab.action === 'add') {
            return (
              <div key={tab.id} className="flex justify-center pb-1">
                <button
                  type="button"
                  onClick={() => openQuickAdd(navigate, pathname)}
                  className="flex h-14 w-14 -translate-y-4 items-center justify-center rounded-full text-white active:scale-95"
                  style={{
                    backgroundColor: BRAND.orange,
                    boxShadow: '0 8px 18px rgba(255, 112, 0, 0.38)',
                  }}
                  aria-label="Ajouter rapidement"
                >
                  <Plus size={26} strokeWidth={2.4} />
                </button>
              </div>
            );
          }

          const Icon = tab.icon;
          const active = pathname === tab.to;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => navigate(tab.to)}
              className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1"
              style={{ color: active ? BRAND.orange : BRAND.textMuted }}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={20} strokeWidth={active ? 2.3 : 1.8} />
              <span className={`text-[10px] leading-tight ${active ? 'font-semibold' : 'font-medium'}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
