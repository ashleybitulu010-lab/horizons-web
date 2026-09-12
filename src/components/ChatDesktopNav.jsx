import { LayoutDashboard, MessageCircle, Plus, User, BarChart2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LOGO_SYMBOL, BRAND } from '@/lib/brandAssets';
import { openQuickAdd } from '@/components/AppBottomNav';

const LINKS = [
  { id: 'ashy', label: 'Ashy', to: '/chat', icon: MessageCircle },
  { id: 'overview', label: "Vue d'ensemble", to: '/dashboard', icon: LayoutDashboard },
  { id: 'reports', label: 'Rapports', to: '/reports', icon: BarChart2 },
  { id: 'profile', label: 'Profil', to: '/profile', icon: User },
];

export default function ChatDesktopNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <aside
      className="hidden lg:flex w-[220px] flex-shrink-0 flex-col border-r bg-white px-4 py-5"
      style={{ borderColor: 'rgba(23, 32, 51, 0.06)' }}
    >
      <div className="mb-8 flex items-center gap-2.5 px-1">
        <img src={LOGO_SYMBOL} alt="" className="h-8 w-8 object-contain" />
        <p className="text-sm font-semibold tracking-tight" style={{ color: BRAND.navy }} translate="no">
          Ash Ledger
        </p>
      </div>

      <nav className="flex flex-1 flex-col gap-1" aria-label="Navigation Ash Ledger">
        {LINKS.map(({ id, label, to, icon: Icon }) => {
          const active = pathname === to;
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigate(to)}
              className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors"
              style={{
                color: active ? BRAND.orange : BRAND.text,
                backgroundColor: active ? 'rgba(255, 112, 0, 0.08)' : 'transparent',
              }}
            >
              <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
              {label}
            </button>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => openQuickAdd(navigate, pathname)}
        className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-white"
        style={{ backgroundColor: BRAND.orange, boxShadow: '0 8px 18px rgba(255, 112, 0, 0.25)' }}
      >
        <Plus size={18} strokeWidth={2.4} />
        Ajouter
      </button>
    </aside>
  );
}
