import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { trackDashboardViewed } from '@/lib/analytics';
import {
  AlertTriangle,
  ArrowLeft,
  BadgeDollarSign,
  BarChart3,
  Box,
  Boxes,
  Clock3,
  HandCoins,
  Lightbulb,
  Package,
  PackagePlus,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  TrendingDown,
  TrendingUp,
  WalletCards,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/context/LanguageContext';
import { useDashboardData } from '@/hooks/useDashboardData';
import {
  formatCompactCurrency,
  formatCurrency,
  saveCurrencyPreference,
} from '@/lib/currency';

const PERIOD_OPTIONS = [
  { id: 'today', label: 'Aujourd’hui' },
  { id: 'week', label: 'Semaine' },
  { id: 'month', label: 'Mois' },
  { id: 'year', label: 'Année' },
];

function formatNumber(value) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value || 0);
}

function formatRelativeDate(date) {
  if (!date) return 'Date non disponible';
  const difference = Date.now() - date.getTime();
  if (difference < 60_000) return 'À l’instant';
  if (difference < 3_600_000) return `Il y a ${Math.floor(difference / 60_000)} min`;
  if (difference < 86_400_000) return `Il y a ${Math.floor(difference / 3_600_000)} h`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function SectionCard({ children, className = '' }) {
  return (
    <section className={`rounded-3xl border border-white/80 bg-white shadow-[0_14px_45px_rgba(99,73,46,0.08)] ${className}`}>
      {children}
    </section>
  );
}

function MetricCard({ icon: Icon, label, value, color, background, change }) {
  const hasChange = change !== null && change !== undefined;
  const isPositive = change >= 0;
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-3xl border border-white/80 bg-white p-4 shadow-[0_12px_35px_rgba(99,73,46,0.07)]"
    >
      <div
        className="absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-40"
        style={{ background }}
      />
      <div className="relative">
        <div className="mb-3 flex items-start justify-between gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ color, background }}>
            <Icon size={21} strokeWidth={1.9} />
          </span>
          {hasChange && (
            <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
              isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}>
              {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {Math.abs(change).toFixed(0)} %
            </span>
          )}
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-400">{label}</p>
        <p className="mt-1 break-words text-2xl font-bold tracking-tight text-stone-900">{value}</p>
      </div>
    </motion.article>
  );
}

function filterTimelineByPeriod(timeline, period) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - 6);
  if (period === 'month') start.setDate(1);
  if (period === 'year') start.setMonth(0, 1);

  return timeline.filter((point) => {
    const date = new Date(`${point.key}T00:00:00`);
    return !Number.isNaN(date.getTime()) && date >= start;
  });
}

function FinancialChart({ data, currency, period, onPeriodChange }) {
  const { t } = useLanguage();
  return (
    <SectionCard>
      <div className="flex flex-col gap-3 px-5 pb-1 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
            <BarChart3 size={17} strokeWidth={2} />
          </span>
          <div>
            <h2 className="text-sm font-bold text-stone-800">{t('dashboard.evolution')}</h2>
            <p className="mt-0.5 text-xs text-stone-400">Chiffre d’affaires, dépenses et bénéfice</p>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-stone-50 p-1">
          {PERIOD_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.id}
              onClick={() => onPeriodChange(option.id)}
              className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                period === option.id
                  ? 'bg-white text-orange-600 shadow-sm'
                  : 'text-stone-400 hover:text-stone-600'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {!data.length ? (
        <div className="flex h-[165px] flex-col items-center justify-center px-6 text-center">
          <BarChart3 size={25} className="mb-2 text-stone-200" />
          <p className="text-sm font-semibold text-stone-400">{t('dashboard.noOps')}</p>
        </div>
      ) : (
        <div className="h-[200px] w-full px-2 pb-3 pr-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#F2EEE9" strokeDasharray="4 4" vertical={false} />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#A8A29E', fontSize: 10 }}
                minTickGap={24}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={58}
                tick={{ fill: '#A8A29E', fontSize: 10 }}
                tickFormatter={(value) => formatCompactCurrency(value, currency)}
              />
              <Tooltip
                formatter={(value, name) => [
                  formatCurrency(value, currency),
                  {
                    ventes: 'Chiffre d’affaires',
                    depenses: 'Dépenses',
                    benefice: 'Bénéfice',
                  }[name] || name,
                ]}
                contentStyle={{
                  border: '1px solid #F3E8DE',
                  borderRadius: 14,
                  boxShadow: '0 10px 30px rgba(70,50,30,.12)',
                  fontSize: 12,
                }}
              />
              <Legend
                iconType="circle"
                iconSize={7}
                formatter={(value) => ({
                  ventes: 'Chiffre d’affaires',
                  depenses: 'Dépenses',
                  benefice: 'Bénéfice',
                }[value] || value)}
                wrapperStyle={{ fontSize: 10 }}
              />
              <Line type="monotone" dataKey="ventes" stroke="#10B981" strokeWidth={2.3} dot={data.length === 1} />
              <Line type="monotone" dataKey="depenses" stroke="#F43F5E" strokeWidth={2.3} dot={data.length === 1} />
              <Line type="monotone" dataKey="benefice" stroke="#3B82F6" strokeWidth={2.3} dot={data.length === 1} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  );
}

function InsightsCard({ insights }) {
  return (
    <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#FF6B00] via-[#F4771D] to-[#F59E0B] p-5 text-white shadow-[0_18px_50px_rgba(255,107,0,0.25)]">
      <div className="absolute -right-14 -top-20 h-52 w-52 rounded-full bg-white/10" />
      <div className="absolute -bottom-16 left-1/3 h-40 w-40 rounded-full bg-white/5" />
      <div className="relative">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 shadow-inner ring-1 ring-white/30 backdrop-blur">
            <Sparkles size={20} />
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-100">Analyse automatique</p>
            <h2 className="text-lg font-bold">Ashy Insights</h2>
          </div>
        </div>
        {insights.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {insights.map((insight) => (
              <div key={insight} className="flex gap-2.5 rounded-2xl bg-white/12 p-3 ring-1 ring-white/15 backdrop-blur-sm">
                <Lightbulb size={16} className="mt-0.5 shrink-0 text-amber-100" />
                <p className="text-sm font-medium leading-relaxed text-white/95">{insight}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-white/12 p-4 text-sm leading-relaxed text-orange-50 ring-1 ring-white/15">
            Ashy affichera ses conseils dès que vos données Supabase contiendront des opérations analysables.
          </div>
        )}
      </div>
    </section>
  );
}

const ACTIVITY_STYLE = {
  vente: { icon: ShoppingBag, color: 'text-emerald-600', background: 'bg-emerald-50' },
  paiement: { icon: HandCoins, color: 'text-cyan-600', background: 'bg-cyan-50' },
  depense: { icon: ReceiptText, color: 'text-rose-600', background: 'bg-rose-50' },
  produit: { icon: Package, color: 'text-blue-600', background: 'bg-blue-50' },
  stock: { icon: PackagePlus, color: 'text-violet-600', background: 'bg-violet-50' },
};

function RecentActivities({ activities, currency }) {
  const { t } = useLanguage();
  return (
    <SectionCard className="h-full">
      <div className="flex items-center justify-between px-5 pb-3 pt-5 sm:px-6">
        <div>
          <h2 className="text-base font-bold text-stone-800">{t('dashboard.recent')}</h2>
          <p className="mt-0.5 text-xs text-stone-400">Dernières opérations synchronisées</p>
        </div>
        <Clock3 size={19} className="text-stone-300" />
      </div>
      {!activities.length ? (
        <div className="px-6 py-14 text-center text-sm text-stone-400">Aucune opération récente.</div>
      ) : (
        <div className="divide-y divide-stone-100 px-5 pb-3 sm:px-6">
          {activities.map((activity) => {
            const style = ACTIVITY_STYLE[activity.type] || ACTIVITY_STYLE.produit;
            const Icon = style.icon;
            return (
              <div key={activity.id} className="flex items-center gap-3 py-3.5">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${style.background} ${style.color}`}>
                  <Icon size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-stone-700">{activity.title}</p>
                  <p className="truncate text-xs text-stone-400">{activity.detail}</p>
                </div>
                <div className="shrink-0 text-right">
                  {activity.amount !== null && (
                    <p className={`text-xs font-bold ${activity.type === 'depense' ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {activity.type === 'depense' ? '−' : '+'}
                      {formatCurrency(activity.amount, currency)}
                    </p>
                  )}
                  <p className="mt-0.5 text-[10px] text-stone-300">{formatRelativeDate(activity.date)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

const ALERT_STYLE = {
  positive: { background: 'bg-emerald-50', color: 'text-emerald-700', icon: TrendingUp },
  warning: { background: 'bg-amber-50', color: 'text-amber-700', icon: AlertTriangle },
  danger: { background: 'bg-rose-50', color: 'text-rose-700', icon: AlertTriangle },
};

function SmartAlerts({ alerts }) {
  const { t } = useLanguage();
  return (
    <SectionCard className="h-full">
      <div className="flex items-center justify-between px-5 pb-3 pt-5 sm:px-6">
        <div>
          <h2 className="text-base font-bold text-stone-800">{t('dashboard.alerts')}</h2>
          <p className="mt-0.5 text-xs text-stone-400">Signaux calculés depuis vos données</p>
        </div>
        <Sparkles size={19} className="text-orange-400" />
      </div>
      {!alerts.length ? (
        <div className="flex flex-col items-center px-6 py-14 text-center">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <Sparkles size={19} />
          </span>
          <p className="text-sm font-semibold text-stone-500">{t('dashboard.noAlerts')}</p>
          <p className="mt-1 text-xs text-stone-300">Ashy continue d’analyser vos opérations.</p>
        </div>
      ) : (
        <div className="space-y-2.5 px-5 pb-5 sm:px-6">
          {alerts.map((alert) => {
            const style = ALERT_STYLE[alert.tone] || ALERT_STYLE.warning;
            const Icon = style.icon;
            return (
              <div key={alert.id} className={`flex gap-3 rounded-2xl p-3.5 ${style.background}`}>
                <Icon size={17} className={`mt-0.5 shrink-0 ${style.color}`} />
                <div>
                  <p className={`text-xs font-bold ${style.color}`}>{alert.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-stone-600">{alert.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

function DebtSummary({ debts, currency }) {
  const { t } = useLanguage();
  const money = (value) => formatCurrency(value, currency);
  const hasDebt = debts.remaining > 0;

  return (
    <SectionCard>
      <div className="flex items-center justify-between px-5 pb-3 pt-5 sm:px-6">
        <div>
          <h2 className="text-base font-bold text-stone-800">{t('dashboard.debts')}</h2>
          <p className="mt-0.5 text-xs text-stone-400">Créances et paiements synchronisés</p>
        </div>
        <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${
          hasDebt ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'
        }`}>
          <HandCoins size={19} />
        </span>
      </div>
      {!hasDebt && (
        <div className="mx-5 mb-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 sm:mx-6">
          ✅ Aucun client débiteur
        </div>
      )}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-3xl bg-stone-100 sm:grid-cols-4">
        {[
          ['Montant total', money(debts.totalDebt)],
          ['Clients débiteurs', formatNumber(debts.debtorCount)],
          ['Encaissé aujourd’hui', money(debts.collectedToday)],
          ['Reste à récupérer', money(debts.remaining)],
        ].map(([label, value]) => (
          <div key={label} className="bg-white px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">{label}</p>
            <p className="mt-1 text-lg font-bold text-stone-800">{value}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function LoadingDashboard() {
  return (
    <div className="mx-auto w-full max-w-7xl animate-pulse space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="h-40 rounded-[28px] bg-orange-100" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, index) => <div key={index} className="h-32 rounded-3xl bg-white" />)}
      </div>
      <div className="h-64 rounded-3xl bg-white" />
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [chartPeriod, setChartPeriod] = useState('month');
  const [savingCurrency, setSavingCurrency] = useState(false);

  useEffect(() => {
    trackDashboardViewed();
  }, []);
  const {
    metrics,
    trends,
    timeline,
    activities,
    alerts,
    insights,
    debts,
    clientId,
    loading,
    refreshing,
    error,
    lastUpdated,
    realtimeStatus,
    currencySettings,
    setCurrencySettings,
    refresh,
  } = useDashboardData(user, token);

  const currency = currencySettings.currency || currencySettings.displayCurrency;
  const filteredTimeline = useMemo(
    () => filterTimelineByPeriod(timeline, chartPeriod),
    [timeline, chartPeriod],
  );

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
      // Keep current currency if save fails.
    } finally {
      setSavingCurrency(false);
    }
  };

  const metricCards = useMemo(() => [
    {
      icon: BadgeDollarSign,
      label: 'Chiffre d’affaires',
      value: formatCurrency(metrics.revenue, currency),
      color: '#059669',
      background: '#ECFDF5',
      change: trends.salesChange,
    },
    {
      icon: WalletCards,
      label: 'Dépenses',
      value: formatCurrency(metrics.expenses, currency),
      color: '#E11D48',
      background: '#FFF1F2',
      change: trends.expenseChange,
    },
    {
      icon: TrendingUp,
      label: 'Bénéfice estimé',
      value: formatCurrency(metrics.profit, currency),
      color: '#2563EB',
      background: '#EFF6FF',
      change: trends.profitChange,
    },
    {
      icon: Boxes,
      label: 'Valeur du stock',
      value: formatCurrency(metrics.stockValue, currency),
      color: '#7C3AED',
      background: '#F5F3FF',
    },
    {
      icon: Box,
      label: 'Nombre de produits',
      value: formatNumber(metrics.productCount),
      color: '#D97706',
      background: '#FFFBEB',
    },
    {
      icon: Package,
      label: 'Quantité restante',
      value: formatNumber(metrics.stockQuantity),
      color: '#EA580C',
      background: '#FFF7ED',
    },
    {
      icon: HandCoins,
      label: 'Dettes clients',
      value: formatCurrency(metrics.clientDebt, currency),
      color: '#CA8A04',
      background: '#FEFCE8',
    },
  ], [metrics, trends, currency]);

  return (
    <>
      <Helmet>
        <title>{t('dashboard.title')} — Ash Ledger</title>
        <meta name="description" content="Analyse en temps réel de vos ventes, dépenses, bénéfices et stocks." />
      </Helmet>

      <div className="min-h-[100dvh] bg-[#F6F2EC] text-stone-900">
        <header className="sticky top-0 z-30 border-b border-orange-100/70 bg-white/90 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => navigate('/chat')}
              className="flex h-10 w-10 items-center justify-center rounded-2xl text-stone-500 transition hover:bg-orange-50 hover:text-orange-600 active:scale-95"
              aria-label="Retour à Ashy"
            >
              <ArrowLeft size={20} />
            </button>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-md shadow-orange-200">
              <BarChart3 size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-bold tracking-tight">{t('dashboard.title')}</h1>
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-stone-400">
                {realtimeStatus === 'connected' ? (
                  <Wifi size={11} className="text-emerald-500" />
                ) : (
                  <WifiOff size={11} className={realtimeStatus === 'error' ? 'text-rose-500' : 'text-amber-500'} />
                )}
                <span>
                  {realtimeStatus === 'connected'
                    ? 'Synchronisé en temps réel'
                    : realtimeStatus === 'connecting' ? 'Connexion en cours…' : 'Synchronisation interrompue'}
                </span>
              </div>
            </div>
            {lastUpdated && (
              <span className="hidden text-[11px] text-stone-400 sm:block">
                Mis à jour {formatRelativeDate(lastUpdated).toLowerCase()}
              </span>
            )}
            <label className="sr-only" htmlFor="dashboard-currency">Devise</label>
            <select
              id="dashboard-currency"
              value={currency}
              disabled={loading || savingCurrency || !clientId}
              onChange={(event) => changeCurrency(event.target.value)}
              className="h-10 rounded-2xl border border-stone-100 bg-white px-3 text-xs font-semibold text-stone-600 shadow-sm outline-none transition hover:border-orange-100 focus:border-orange-300 disabled:opacity-50"
              aria-label="Choisir la devise"
            >
              <option value="USD">USD ($)</option>
              <option value="CDF">CDF (FC)</option>
            </select>
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing || loading}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-stone-100 bg-white text-stone-500 shadow-sm transition hover:border-orange-100 hover:text-orange-600 active:scale-95 disabled:opacity-50"
              aria-label="Actualiser les données"
            >
              <RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </header>

        {loading ? <LoadingDashboard /> : error ? (
          <main className="mx-auto flex min-h-[70vh] max-w-xl items-center px-5 py-16">
            <div className="w-full rounded-3xl border border-rose-100 bg-white p-8 text-center shadow-sm">
              <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
                <WifiOff size={24} />
              </span>
              <h2 className="text-lg font-bold text-stone-800">{t('dashboard.unavailable')}</h2>
              <p className="mt-2 text-sm leading-relaxed text-stone-500">{error}</p>
              <button
                type="button"
                onClick={refresh}
                className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 text-sm font-bold text-white transition active:scale-95"
              >
                <RefreshCw size={16} />
                Réessayer
              </button>
            </div>
          </main>
        ) : (
          <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-orange-500">{t('dashboard.overview')}</p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                Bonjour {user?.firstName || user?.name || '—'}
              </h2>
              <p className="mt-1 text-sm text-stone-500">Voici l’état actuel de votre activité.</p>
            </div>

            <InsightsCard insights={insights} />

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
              {metricCards.map((card) => <MetricCard key={card.label} {...card} />)}
            </div>

            <FinancialChart
              data={filteredTimeline}
              currency={currency}
              period={chartPeriod}
              onPeriodChange={setChartPeriod}
            />

            <DebtSummary debts={debts} currency={currency} />

            <div className="grid items-start gap-4 lg:grid-cols-2">
              <RecentActivities activities={activities} currency={currency} />
              <SmartAlerts alerts={alerts} />
            </div>

            <p className="pb-2 text-center text-[11px] text-stone-400">
              Devise unique : {currency}. Les montants du tableau de bord et des tables sont les mêmes.
            </p>
          </main>
        )}
      </div>
    </>
  );
}
