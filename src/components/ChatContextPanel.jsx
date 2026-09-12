import { useEffect, useState } from 'react';
import { ASHY_EXPLANATION, ASHY_GREETING, BRAND } from '@/lib/brandAssets';
import { formatCurrency } from '@/lib/currency';
import { useAuth } from '@/hooks/useAuth';
import { useDashboardData } from '@/hooks/useDashboardData';

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs" style={{ color: BRAND.textMuted }}>{label}</span>
      <span className="text-sm font-semibold" style={{ color: BRAND.text }}>{value}</span>
    </div>
  );
}

function ChatContextPanelBody() {
  const { user, token } = useAuth();
  const {
    metrics,
    activities,
    insights,
    loading,
    error,
    currencySettings,
  } = useDashboardData(user, token);
  const currency = currencySettings?.currency || currencySettings?.displayCurrency || 'USD';
  const lastActivity = Array.isArray(activities) && activities.length ? activities[0] : null;
  const insight = Array.isArray(insights) && insights.length ? insights[0] : null;
  const hasMetrics = Boolean(metrics)
    && ((metrics.revenue || 0) + (metrics.expenses || 0) + (metrics.profit || 0) + (metrics.stockValue || 0) + (metrics.clientDebt || 0) > 0);

  return (
    <aside
      className="hidden xl:flex w-[280px] flex-shrink-0 flex-col gap-4 overflow-y-auto border-l bg-white px-5 py-5"
      style={{ borderColor: 'rgba(23, 32, 51, 0.06)' }}
    >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: BRAND.orange }}>
          Aujourd’hui
        </p>
        <h2 className="mt-1 text-base font-semibold" style={{ color: BRAND.text }}>
          Ton activité
        </h2>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: BRAND.textMuted }}>Chargement du résumé…</p>
      ) : error || !hasMetrics ? (
        <div className="rounded-2xl px-4 py-5 text-center" style={{ backgroundColor: '#E9F1FB' }}>
          <img
            src={ASHY_GREETING}
            alt=""
            className="mx-auto mb-3 h-20 w-20 object-contain object-top"
          />
          <p className="text-sm leading-relaxed" style={{ color: BRAND.text }}>
            Je n'ai pas encore trouvé de données pour cette période.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-stone-100 bg-[#F8FAFD] px-4 py-3">
          <Row label="Encaissements" value={formatCurrency(metrics.revenue, currency)} />
          <Row label="Dépenses" value={formatCurrency(metrics.expenses, currency)} />
          <Row label="Bénéfice" value={formatCurrency(metrics.profit, currency)} />
          <Row label="Dettes clients" value={formatCurrency(metrics.clientDebt, currency)} />
        </div>
      )}

      {lastActivity && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: BRAND.textMuted }}>
            Dernière opération
          </p>
          <div className="rounded-2xl border border-stone-100 px-4 py-3">
            <p className="text-sm font-medium" style={{ color: BRAND.text }}>
              {lastActivity.title || 'Opération'}
            </p>
            {lastActivity.detail && (
              <p className="mt-0.5 truncate text-xs" style={{ color: BRAND.textMuted }}>
                {lastActivity.detail}
              </p>
            )}
            {lastActivity.amount != null && (
              <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.navy }}>
                {formatCurrency(lastActivity.amount, currency)}
              </p>
            )}
          </div>
        </div>
      )}

      {insight && (
        <div className="mt-auto rounded-2xl px-4 py-4" style={{ backgroundColor: '#E9F1FB' }}>
          <div className="mb-2 flex items-center gap-2">
            <img src={ASHY_EXPLANATION} alt="" className="h-10 w-10 object-contain object-top" />
            <p className="text-xs font-semibold" style={{ color: BRAND.navy }}>Insight Ashy</p>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: BRAND.text }}>{insight}</p>
        </div>
      )}
    </aside>
  );
}

export default function ChatContextPanel() {
  const [enabled, setEnabled] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches
  ));

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1280px)');
    const update = () => setEnabled(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  if (!enabled) return null;
  return <ChatContextPanelBody />;
}
