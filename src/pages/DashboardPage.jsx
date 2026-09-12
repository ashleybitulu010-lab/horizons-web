import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { trackDashboardViewed } from '@/lib/analytics';
import {
  Boxes,
  HandCoins,
  PackagePlus,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  Users,
  Wallet,
  WifiOff,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/hooks/useAuth';
import { useDashboardData } from '@/hooks/useDashboardData';
import AppBottomNav, { goChatWithDraft } from '@/components/AppBottomNav';
import ChatDesktopNav from '@/components/ChatDesktopNav';
import QuickAddSheet from '@/components/QuickAddSheet';
import {
  formatCompactCurrency,
  formatCurrency,
  saveCurrencyPreference,
} from '@/lib/currency';
import {
  DASHBOARD_PERIODS,
  INSUFFICIENT_INSIGHT,
} from '@/lib/dashboardAnalytics';
import { ASHY_EXPLANATION, BRAND, LOGO_SYMBOL } from '@/lib/brandAssets';

function formatRelativeDate(date) {
  if (!date) return 'Date non disponible';
  const difference = Date.now() - date.getTime();
  if (difference < 60_000) return 'À l’instant';
  if (difference < 3_600_000) return `Il y a ${Math.floor(difference / 60_000)} min`;
  if (difference < 86_400_000) return `Il y a ${Math.floor(difference / 3_600_000)} h`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function formatChange(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  const n = Number(value);
  const formatted = Math.abs(n).toLocaleString('fr-FR', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 1,
    maximumFractionDigits: 1,
  });
  return { positive: n >= 0, label: `${formatted} %` };
}

function ChangeBadge({ value, vsLabel, light = false }) {
  const change = formatChange(value);
  if (!change) return null;
  const color = light
    ? (change.positive ? '#B8F0DE' : '#F8C9C9')
    : (change.positive ? BRAND.success : BRAND.error);
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs font-semibold" style={{ color }}>
      {change.positive ? '↑' : '↓'} {change.label}
      {vsLabel ? (
        <span className="font-medium" style={{ color: light ? 'rgba(255,255,255,0.72)' : BRAND.textMuted }}>
          {vsLabel}
        </span>
      ) : null}
    </span>
  );
}

function PeriodSwitcher({ value, onChange }) {
  return (
    <div
      className="flex w-full gap-1 rounded-2xl p-1"
      style={{ backgroundColor: '#E9F1FB' }}
      role="tablist"
      aria-label="Période"
    >
      {DASHBOARD_PERIODS.map((option) => {
        const active = value === option.id;
        return (
          <button
            type="button"
            key={option.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.id)}
            className="min-h-10 flex-1 rounded-xl px-2 text-[12px] font-semibold transition"
            style={{
              backgroundColor: active ? BRAND.white : 'transparent',
              color: active ? BRAND.navy : BRAND.textMuted,
              boxShadow: active ? '0 1px 4px rgba(23, 59, 115, 0.08)' : 'none',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function MetricTile({ label, value, change, vsLabel, color }) {
  return (
    <article
      className="rounded-2xl border bg-white px-4 py-3.5"
      style={{ borderColor: 'rgba(23, 32, 51, 0.06)', boxShadow: '0 6px 18px rgba(23, 59, 115, 0.04)' }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: BRAND.textMuted }}>
        {label}
      </p>
      <p className="mt-1 break-words text-lg font-bold tracking-tight sm:text-xl" style={{ color: BRAND.text }}>
        {value}
      </p>
      <div className="mt-1.5 min-h-[18px]">
        <ChangeBadge value={change} vsLabel={vsLabel} />
      </div>
      <span className="mt-2 block h-1 w-8 rounded-full" style={{ backgroundColor: color }} />
    </article>
  );
}

function FinancialChart({ data, currency }) {
  const hasValues = (data || []).some((point) => (
    Number(point.ventes) || Number(point.depenses) || Number(point.benefice)
  ));

  return (
    <section
      className="rounded-2xl border bg-white px-4 py-4 sm:px-5"
      style={{ borderColor: 'rgba(23, 32, 51, 0.06)', boxShadow: '0 6px 18px rgba(23, 59, 115, 0.04)' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: BRAND.text }}>Évolution financière</h2>
      <p className="mt-0.5 text-xs" style={{ color: BRAND.textMuted }}>Revenus, dépenses et bénéfice</p>
      {!hasValues ? (
        <div className="flex h-[168px] items-center justify-center text-center text-sm" style={{ color: BRAND.textMuted }}>
          Pas encore d’évolution à afficher pour cette période.
        </div>
      ) : (
        <div className="mt-3 h-[180px] w-full min-w-0 sm:h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#E9F1FB" strokeDasharray="4 4" vertical={false} />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: BRAND.textFaint, fontSize: 10 }}
                minTickGap={28}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={52}
                tick={{ fill: BRAND.textFaint, fontSize: 10 }}
                tickFormatter={(value) => formatCompactCurrency(value, currency)}
              />
              <Tooltip
                formatter={(value, name) => [
                  formatCurrency(value, currency),
                  { ventes: 'Revenus', depenses: 'Dépenses', benefice: 'Bénéfice' }[name] || name,
                ]}
                contentStyle={{
                  border: '1px solid rgba(23, 32, 51, 0.08)',
                  borderRadius: 12,
                  fontSize: 12,
                }}
              />
              <Line type="monotone" dataKey="ventes" stroke={BRAND.success} strokeWidth={2.2} dot={false} />
              <Line type="monotone" dataKey="depenses" stroke={BRAND.error} strokeWidth={2.2} dot={false} />
              <Line type="monotone" dataKey="benefice" stroke={BRAND.navy} strokeWidth={2.2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium" style={{ color: BRAND.textMuted }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BRAND.success }} /> Revenus
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BRAND.error }} /> Dépenses
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BRAND.navy }} /> Bénéfice
        </span>
      </div>
    </section>
  );
}

const ACTIVITY_STYLE = {
  vente: { icon: ShoppingBag, color: BRAND.success },
  paiement: { icon: Wallet, color: BRAND.navy },
  depense: { icon: ReceiptText, color: BRAND.error },
  stock: { icon: PackagePlus, color: BRAND.blue },
  dette: { icon: HandCoins, color: '#D97706' },
  produit: { icon: Boxes, color: BRAND.navy },
};

function RecentActivities({ activities, currency, onSeeAll }) {
  return (
    <section
      className="rounded-2xl border bg-white px-4 py-4 sm:px-5"
      style={{ borderColor: 'rgba(23, 32, 51, 0.06)', boxShadow: '0 6px 18px rgba(23, 59, 115, 0.04)' }}
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold" style={{ color: BRAND.text }}>Dernières opérations</h2>
        <button
          type="button"
          onClick={onSeeAll}
          className="text-xs font-semibold"
          style={{ color: BRAND.orange }}
        >
          Voir tout
        </button>
      </div>
      {!activities.length ? (
        <p className="py-8 text-center text-sm" style={{ color: BRAND.textMuted }}>
          Aucune opération sur cette période.
        </p>
      ) : (
        <div className="divide-y" style={{ borderColor: 'rgba(23, 32, 51, 0.05)' }}>
          {activities.map((activity) => {
            const style = ACTIVITY_STYLE[activity.type] || ACTIVITY_STYLE.vente;
            const Icon = style.icon;
            const negative = activity.type === 'depense';
            return (
              <div key={activity.id} className="flex items-center gap-3 py-3">
                <span
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: '#E9F1FB', color: style.color }}
                >
                  <Icon size={17} strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" style={{ color: BRAND.text }}>{activity.title}</p>
                  <p className="truncate text-xs" style={{ color: BRAND.textMuted }}>{activity.detail}</p>
                </div>
                <div className="shrink-0 text-right">
                  {activity.amount !== null && (
                    <p className="text-xs font-bold" style={{ color: negative ? BRAND.error : BRAND.success }}>
                      {negative ? '−' : '+'}
                      {formatCurrency(activity.amount, currency)}
                    </p>
                  )}
                  <p className="mt-0.5 text-[10px]" style={{ color: BRAND.textFaint }}>
                    {formatRelativeDate(activity.date)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LoadingDashboard() {
  return (
    <div className="mx-auto w-full max-w-6xl animate-pulse space-y-4 px-4 py-6">
      <div className="h-16 rounded-2xl bg-white" />
      <div className="h-32 rounded-2xl bg-white" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 rounded-2xl bg-white" />)}
      </div>
      <div className="h-56 rounded-2xl bg-white" />
    </div>
  );
}

export default function DashboardPage() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [period, setPeriod] = useState('week');
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  useEffect(() => {
    trackDashboardViewed();
  }, []);

  useEffect(() => {
    const open = () => setQuickAddOpen(true);
    window.addEventListener('ash:open-quick-add', open);
    return () => window.removeEventListener('ash:open-quick-add', open);
  }, []);

  const {
    metrics,
    periodSnapshots,
    debts,
    clientId,
    loading,
    refreshing,
    error,
    currencySettings,
    setCurrencySettings,
    refresh,
  } = useDashboardData(user, token);

  useEffect(() => {
    if (!clientId) return;
    refresh();
  }, [location.key, clientId, refresh]);

  const currency = currencySettings.currency || currencySettings.displayCurrency;
  const snapshot = periodSnapshots?.[period] || periodSnapshots?.week || {
    solde: 0,
    revenue: 0,
    expenses: 0,
    profit: 0,
    activeClients: 0,
    timeline: [],
    activities: [],
    insight: INSUFFICIENT_INSIGHT,
    hasInsight: false,
    previousLabel: 'vs semaine dernière',
  };
  const firstName = user?.firstName || user?.name?.split(' ')[0] || '';

  const changeCurrency = async (nextCurrency) => {
    if (!clientId || !user?.id || nextCurrency === currency || savingCurrency) return;
    setSavingCurrency(true);
    try {
      const saved = await saveCurrencyPreference({
        clientId,
        userId: user.id,
        currency: nextCurrency,
      });
      setCurrencySettings(saved);
    } catch {
      /* keep current */
    } finally {
      setSavingCurrency(false);
    }
  };

  const handleQuickAdd = (item) => {
    const draft = String(item?.draft || '');
    if (!draft) return;
    setQuickAddOpen(false);
    goChatWithDraft(navigate, draft, { send: item.send });
  };

  const debtCount = Math.max(debts?.debtorCount || 0, debts?.remaining > 0 ? 1 : 0);
  const overdueNote = debts?.overdueCount > 0
    ? `${debts.overdueCount} dette${debts.overdueCount > 1 ? 's' : ''} en retard`
    : (debtCount > 0
      ? `${debtCount} client${debtCount > 1 ? 's' : ''} ${debtCount > 1 ? 'doivent' : 'doit'} encore payer`
      : 'Aucune dette en cours');

  const tiles = useMemo(() => [
    {
      label: 'Revenus',
      value: formatCurrency(snapshot.revenue, currency),
      change: snapshot.revenueChange,
      color: BRAND.success,
    },
    {
      label: 'Dépenses',
      value: formatCurrency(snapshot.expenses, currency),
      change: snapshot.expenseChange,
      color: BRAND.orange,
    },
    {
      label: 'Bénéfice',
      value: formatCurrency(snapshot.profit, currency),
      change: snapshot.profitChange,
      color: BRAND.navy,
    },
    {
      label: 'Stock',
      value: formatCurrency(metrics.stockValue, currency),
      change: null,
      color: BRAND.blue,
    },
  ], [snapshot, metrics.stockValue, currency]);

  return (
    <>
      <Helmet>
        <title>Vue d’ensemble — Ash Ledger</title>
        <meta name="description" content="Situation réelle de ton activité : revenus, dépenses, bénéfice, stock et dettes." />
      </Helmet>

      <div className="flex min-h-[100dvh]" style={{ backgroundColor: BRAND.bg, color: BRAND.text }}>
        <ChatDesktopNav />

        <div className="flex min-w-0 flex-1 flex-col">
          <header
            className="safe-area-top sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b bg-white px-4 py-2 lg:px-6"
            style={{ borderColor: 'rgba(23, 32, 51, 0.06)' }}
          >
            <img src={LOGO_SYMBOL} alt="" className="h-8 w-8 flex-shrink-0 object-contain lg:hidden" />
            <h1 className="min-w-0 flex-1 truncate text-sm font-semibold lg:text-base" style={{ color: BRAND.navy }}>
              Vue d’ensemble
            </h1>
            <label className="sr-only" htmlFor="dashboard-currency">Devise</label>
            <select
              id="dashboard-currency"
              value={currency}
              disabled={loading || savingCurrency || !clientId}
              onChange={(event) => changeCurrency(event.target.value)}
              className="h-10 rounded-xl border bg-white px-2.5 text-xs font-semibold outline-none disabled:opacity-50"
              style={{ borderColor: 'rgba(23, 32, 51, 0.08)', color: BRAND.text }}
            >
              <option value="USD">USD ($)</option>
              <option value="CDF">CDF (FC)</option>
            </select>
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing || loading}
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ color: BRAND.navy }}
              aria-label="Actualiser"
            >
              <RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </header>

          {loading ? <LoadingDashboard /> : error ? (
            <main className="mx-auto flex min-h-[60vh] max-w-md items-center px-5 py-16">
              <div className="w-full rounded-2xl border bg-white p-8 text-center" style={{ borderColor: 'rgba(214, 69, 69, 0.15)' }}>
                <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: '#FFF1F2', color: BRAND.error }}>
                  <WifiOff size={22} />
                </span>
                <h2 className="text-lg font-semibold">Données indisponibles</h2>
                <p className="mt-2 text-sm" style={{ color: BRAND.textMuted }}>{error}</p>
                <button
                  type="button"
                  onClick={refresh}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white"
                  style={{ backgroundColor: BRAND.orange }}
                >
                  <RefreshCw size={16} />
                  Réessayer
                </button>
              </div>
            </main>
          ) : (
            <main className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5 pb-28 sm:px-6 lg:px-8 lg:pb-10">
              <div>
                <h2 className="text-xl font-bold tracking-tight sm:text-2xl" style={{ color: BRAND.text }}>
                  Bonjour {firstName || '—'} 👋
                </h2>
                <p className="mt-1 text-sm" style={{ color: BRAND.textMuted }}>
                  Voici la situation de ton activité.
                </p>
              </div>

              <PeriodSwitcher value={period} onChange={setPeriod} />

              <motion.section
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl px-5 py-5 text-white"
                style={{ backgroundColor: BRAND.navy, boxShadow: '0 10px 28px rgba(23, 59, 115, 0.18)' }}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Solde actuel</p>
                <p className="mt-2 break-words text-3xl font-bold tracking-tight sm:text-4xl">
                  {formatCurrency(snapshot.solde, currency)}
                </p>
                <div className="mt-2 text-sm text-white/90">
                  <ChangeBadge value={snapshot.soldeChange} vsLabel={snapshot.previousLabel} light />
                </div>
              </motion.section>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {tiles.map((tile) => (
                  <MetricTile
                    key={tile.label}
                    {...tile}
                    vsLabel={snapshot.previousLabel}
                  />
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <article
                  className="rounded-2xl border bg-white px-4 py-3.5"
                  style={{ borderColor: 'rgba(23, 32, 51, 0.06)', boxShadow: '0 6px 18px rgba(23, 59, 115, 0.04)' }}
                >
                  <div className="mb-2 flex items-center gap-2" style={{ color: BRAND.navy }}>
                    <Users size={16} />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: BRAND.textMuted }}>
                      Clients
                    </p>
                  </div>
                  <p className="text-2xl font-bold">{snapshot.activeClients}</p>
                  <p className="mt-1 text-xs" style={{ color: BRAND.textMuted }}>Clients actifs</p>
                </article>
                <article
                  className="rounded-2xl border bg-white px-4 py-3.5"
                  style={{ borderColor: 'rgba(23, 32, 51, 0.06)', boxShadow: '0 6px 18px rgba(23, 59, 115, 0.04)' }}
                >
                  <div className="mb-2 flex items-center gap-2" style={{ color: '#D97706' }}>
                    <HandCoins size={16} />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: BRAND.textMuted }}>
                      Dettes clients
                    </p>
                  </div>
                  <p className="text-lg font-bold leading-tight sm:text-2xl">
                    {formatCurrency(metrics.clientDebt, currency)}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: debts?.remaining > 0 ? '#B45309' : BRAND.textMuted }}>
                    {overdueNote}
                  </p>
                </article>
              </div>

              <FinancialChart data={snapshot.timeline} currency={currency} />

              <section
                className="flex gap-3 rounded-2xl border px-4 py-4 sm:px-5"
                style={{
                  backgroundColor: '#E9F1FB',
                  borderColor: 'rgba(23, 59, 115, 0.08)',
                }}
              >
                <img
                  src={ASHY_EXPLANATION}
                  alt=""
                  className="h-14 w-14 flex-shrink-0 object-contain object-top sm:h-16 sm:w-16"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: BRAND.navy }}>✨ Insight Ashy</p>
                  <p className="mt-1 text-sm leading-relaxed" style={{ color: BRAND.text }}>
                    {snapshot.insight}
                  </p>
                </div>
              </section>

              <RecentActivities
                activities={snapshot.activities}
                currency={currency}
                onSeeAll={() => navigate('/chat')}
              />
            </main>
          )}

          <AppBottomNav />
        </div>
      </div>

      <QuickAddSheet
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onPick={handleQuickAdd}
      />
    </>
  );
}
