import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Calendar, CheckCircle2, AlertCircle, Clock, Crown, RefreshCw, Sparkles, WifiOff,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { createDashboardSession, supabase } from '@/lib/supabaseRest';
import { syncSubscriptionAnalytics, trackEvent } from '@/lib/analytics';

const FEATURES = [
  'Assistant IA financier illimité',
  'Rapports et tableaux de bord',
  'Analyse des ventes en temps réel',
  'Support prioritaire',
];
const ACCENT = '#FF6B00';
const MS_PER_DAY = 86400000;

const STATUS_LABELS = {
  trial: 'Essai en cours',
  active: 'Abonnement actif',
  expired: 'Abonnement expiré',
  cancelled: 'Abonnement annulé',
};

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function computeMetrics(row) {
  if (!row) return null;
  const now = Date.now();
  const startMs = new Date(row.start_date).getTime();
  const endMs = new Date(row.end_date).getTime();
  let status = row.status;
  if (Number.isFinite(endMs) && endMs < now && status !== 'cancelled') status = 'expired';
  const totalDays = Math.max(1, Math.ceil((endMs - startMs) / MS_PER_DAY));
  const daysRemaining = Number.isFinite(endMs) ? Math.max(0, Math.ceil((endMs - now) / MS_PER_DAY)) : 0;
  const daysUsed = Math.min(totalDays, totalDays - daysRemaining);
  const usagePercent = Math.min(100, Math.max(0, Math.round((daysUsed / totalDays) * 100)));
  const planLabel = status === 'active' || row.plan === 'premium' ? 'Premium' : (row.plan === 'trial' ? 'Essai gratuit' : row.plan);
  const isTrial = status === 'trial' || (row.plan === 'trial' && status !== 'expired' && status !== 'cancelled');
  const isPremiumActive = status === 'active' || (row.plan === 'premium' && status !== 'expired' && status !== 'cancelled');
  return {
    ...row, status, planLabel, daysRemaining, usagePercent, totalDays,
    isTrial, isPremiumActive, isExpired: status === 'expired', isCancelled: status === 'cancelled',
    startDateFormatted: formatDate(row.start_date), endDateFormatted: formatDate(row.end_date),
  };
}

function rowFromDates({ plan, status, start_date, end_date, source }) {
  if (!end_date && !start_date) return null;
  const end = end_date ? new Date(end_date) : new Date(Date.now() + 30 * MS_PER_DAY);
  const start = start_date ? new Date(start_date) : new Date(end.getTime() - 30 * MS_PER_DAY);
  const now = Date.now();
  let resolvedStatus = status || 'trial';
  if (!status) {
    if (end.getTime() <= now) resolvedStatus = 'expired';
    else if (end.getTime() - now > 30 * MS_PER_DAY) resolvedStatus = 'active';
    else resolvedStatus = 'trial';
  }
  const resolvedPlan = plan || (resolvedStatus === 'active' ? 'premium' : 'trial');
  return {
    plan: resolvedPlan,
    status: resolvedStatus,
    start_date: start.toISOString(),
    end_date: end.toISOString(),
    source,
  };
}

async function loadSubscriptionFromSupabase(pocketBaseToken) {
  if (!supabase || !pocketBaseToken) return null;
  const clientId = await createDashboardSession(pocketBaseToken);

  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id,nom_client,date_inscription,date_fin_abonnement,auth_user_id')
    .eq('id', clientId)
    .single();
  if (clientError) throw clientError;
  if (!client) return null;

  let subRow = null;
  if (client.auth_user_id) {
    const { data: sub, error: subError } = await supabase
      .from('subscriptions')
      .select('plan,status,start_date,end_date,user_id')
      .eq('user_id', client.auth_user_id)
      .order('end_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subError) throw subError;
    subRow = sub;
  }

  if (subRow?.end_date || subRow?.start_date) {
    return rowFromDates({
      plan: subRow.plan,
      status: subRow.status,
      start_date: subRow.start_date || client.date_inscription,
      end_date: subRow.end_date || client.date_fin_abonnement,
      source: 'subscriptions+clients',
    });
  }

  return rowFromDates({
    plan: 'trial',
    status: null,
    start_date: client.date_inscription,
    end_date: client.date_fin_abonnement,
    source: 'clients',
  });
}

function useSubscription(user, token) {
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSubscription = useCallback(async () => {
    if (!user?.id || !token) {
      setRow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const sub = await loadSubscriptionFromSupabase(token);
      if (!sub) {
        setError('Aucune donnée d’abonnement trouvée pour votre compte.');
        setRow(null);
        return;
      }
      setRow(sub);
    } catch (err) {
      setError(err?.message || 'Impossible de charger votre abonnement.');
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [user?.id, token]);

  useEffect(() => { fetchSubscription(); }, [fetchSubscription]);

  return {
    subscription: useMemo(() => computeMetrics(row), [row]),
    loading,
    error,
    refresh: fetchSubscription,
  };
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-28 bg-gray-100 rounded-2xl" />
      <div className="h-4 bg-gray-100 rounded-lg w-2/3" />
      <div className="h-3 bg-gray-100 rounded-lg w-full" />
      <div className="h-24 bg-gray-100 rounded-2xl" />
    </div>
  );
}

function StatusBadge({ subscription }) {
  if (subscription.isExpired) return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-600 border border-red-200">
      <AlertCircle size={14} /> Abonnement expiré
    </span>
  );
  if (subscription.isPremiumActive) return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
      <CheckCircle2 size={14} /> Abonnement actif
    </span>
  );
  if (subscription.isTrial) return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-orange-50 text-orange-600 border border-orange-200">
      <Sparkles size={14} /> {STATUS_LABELS.trial}
    </span>
  );
  if (subscription.isCancelled) return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200">
      {STATUS_LABELS.cancelled}
    </span>
  );
  return null;
}

export default function SubscriptionPage() {
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { subscription, loading, error, refresh } = useSubscription(user, token);

  useEffect(() => {
    if (subscription) syncSubscriptionAnalytics(subscription);
  }, [subscription]);

  const handleSubscribe = () => {
    // Intent signal while WhatsApp checkout completes offline.
    trackEvent('subscription_checkout_started', { channel: 'whatsapp' });
    window.open('https://wa.me/243821386516?text=Bonjour%2C%20je%20souhaite%20m%27abonner%20%C3%A0%20Ash%20Ledger%20Premium.', '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <Helmet>
        <title>Mon abonnement — Ash Ledger</title>
        <meta name="description" content="Consultez votre plan, vos dates et votre statut d'abonnement Ash Ledger." />
      </Helmet>

      <div className="min-h-[100dvh] flex flex-col" style={{ backgroundColor: '#F5F1EB' }}>
        <header
          className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
          style={{ backgroundColor: ACCENT, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
        >
          <button
            onClick={() => navigate('/chat')}
            className="w-9 h-9 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors active:scale-95"
          >
            <ArrowLeft size={20} strokeWidth={2} />
          </button>
          <h1 className="text-white font-semibold text-base flex-1">Mon abonnement</h1>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="w-9 h-9 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors active:scale-95 disabled:opacity-50"
            aria-label="Actualiser"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6 max-w-lg mx-auto w-full space-y-4">
          {loading ? (
            <LoadingSkeleton />
          ) : error ? (
            <div className="bg-white rounded-2xl border border-rose-100 p-6 text-center shadow-sm">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
                <WifiOff size={22} />
              </span>
              <p className="text-sm font-semibold text-stone-800">Données indisponibles</p>
              <p className="mt-2 text-xs text-stone-500">{error}</p>
              <button
                type="button"
                onClick={refresh}
                className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-white"
                style={{ backgroundColor: ACCENT }}
              >
                <RefreshCw size={14} /> Réessayer
              </button>
            </div>
          ) : subscription ? (
            <>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl shadow-sm p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-stone-400">Plan actuel</p>
                    <h2 className="mt-1 text-xl font-bold text-stone-900 flex items-center gap-2">
                      <Crown size={20} style={{ color: ACCENT }} />
                      {subscription.planLabel}
                    </h2>
                  </div>
                  <StatusBadge subscription={subscription} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-stone-50 p-3">
                    <p className="text-[11px] font-semibold text-stone-400 flex items-center gap-1">
                      <Calendar size={12} /> Début
                    </p>
                    <p className="mt-1 text-sm font-semibold text-stone-800">{subscription.startDateFormatted}</p>
                  </div>
                  <div className="rounded-xl bg-stone-50 p-3">
                    <p className="text-[11px] font-semibold text-stone-400 flex items-center gap-1">
                      <Calendar size={12} /> Fin
                    </p>
                    <p className="mt-1 text-sm font-semibold text-stone-800">{subscription.endDateFormatted}</p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-semibold text-stone-500 flex items-center gap-1">
                      <Clock size={12} /> Jours restants
                    </span>
                    <span className="font-bold text-stone-800">{subscription.daysRemaining} j</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-stone-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${subscription.usagePercent}%`,
                        backgroundColor: subscription.isExpired ? '#EF4444' : ACCENT,
                      }}
                    />
                  </div>
                </div>
              </motion.div>

              <div className="bg-white rounded-2xl shadow-sm p-5">
                <h3 className="text-sm font-bold text-stone-800 mb-3">Inclus dans votre plan</h3>
                <ul className="space-y-2.5">
                  {FEATURES.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm text-stone-600">
                      <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-emerald-500" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>

              {(subscription.isTrial || subscription.isExpired) && (
                <button
                  type="button"
                  onClick={handleSubscribe}
                  className="w-full py-3.5 rounded-xl text-white text-sm font-semibold active:scale-[0.98]"
                  style={{ backgroundColor: ACCENT, boxShadow: '0 4px 14px rgba(255,107,0,0.28)' }}
                >
                  Passer à Premium
                </button>
              )}

              <p className="text-center text-[11px] text-stone-400 pb-2">
                Données synchronisées depuis clients &amp; subscriptions (Supabase).
              </p>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
