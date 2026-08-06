import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Calendar, CheckCircle2, AlertCircle, Clock, Crown, RefreshCw, Sparkles, WifiOff,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import pb from '@/lib/pocketbaseClient';

const FEATURES = [
  'Assistant IA financier illimité',
  'Rapports et tableaux de bord',
  'Analyse des ventes en temps réel',
  'Support prioritaire',
];
const ACCENT = '#FF6B00';
const MS_PER_DAY = 86400000;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://knrwplidgvuvjnuqqmrt.supabase.co';
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const N8N_SUBSCRIPTION_URL = import.meta.env.VITE_N8N_SUBSCRIPTION_URL
  || 'https://n8n.ashledger.tech/webhook/ash-ledger/subscription';

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

function trialFromUser(user) {
  const start = user?.created ? new Date(user.created) : new Date();
  const end = new Date(start.getTime() + 30 * MS_PER_DAY);
  return {
    plan: 'trial',
    status: end.getTime() < Date.now() ? 'expired' : 'trial',
    start_date: start.toISOString(),
    end_date: end.toISOString(),
  };
}

function rowFromSubscriptionPayload(data) {
  if (!data?.end_date && !data?.date_fin_abonnement) return null;
  const end = new Date(data.end_date || data.date_fin_abonnement);
  const startSource = data.start_date || data.date_inscription;
  const start = startSource ? new Date(startSource) : new Date(end.getTime() - 30 * MS_PER_DAY);
  const now = Date.now();
  let status = data.status || 'trial';
  if (!data.status) {
    if (end.getTime() <= now) status = 'expired';
    else if (end.getTime() - now > 30 * MS_PER_DAY) status = 'active';
    else status = 'trial';
  }
  const plan = data.plan || (status === 'active' ? 'premium' : 'trial');
  return {
    plan,
    status,
    start_date: start.toISOString(),
    end_date: end.toISOString(),
  };
}

function rowFromSupabaseClient(client) {
  return rowFromSubscriptionPayload(client);
}

async function fetchClientViaApi(userId) {
  try {
    const res = await fetch(`/hcgi/api/subscription/client?user_id=${encodeURIComponent(userId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.subscription || null;
  } catch {
    return null;
  }
}

async function fetchSupabaseRpc(userId) {
  if (!SUPABASE_ANON || !userId) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_client_subscription`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: userId }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return rowFromSubscriptionPayload(data);
  } catch {
    return null;
  }
}

async function fetchN8nSubscription(userId) {
  if (!userId) return null;
  try {
    const url = `${N8N_SUBSCRIPTION_URL}?user_id=${encodeURIComponent(userId)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    return rowFromSubscriptionPayload(data.subscription || data);
  } catch {
    return null;
  }
}

async function fetchSupabaseClient(userId) {
  if (!SUPABASE_ANON || !userId) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?user_id=eq.${encodeURIComponent(userId)}&select=date_inscription,date_fin_abonnement&limit=1`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rowFromSupabaseClient(rows?.[0]);
  } catch {
    return null;
  }
}

async function fetchSupabaseSubscription(userId) {
  if (!SUPABASE_ANON || !userId) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=plan,status,start_date,end_date&limit=1`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0] || null;
  } catch {
    return null;
  }
}

async function fetchPocketBaseSubscription(userId) {
  try {
    const rec = await pb.collection('subscriptions').getFirstListItem(`owner="${userId}"`);
    return {
      plan: rec.plan || 'trial',
      status: rec.status || 'trial',
      start_date: rec.start_date || rec.created,
      end_date: rec.end_date,
    };
  } catch {
    return null;
  }
}

function useSubscription(user) {
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSubscription = useCallback(async () => {
    if (!user?.id) { setRow(null); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const sub = await fetchSupabaseRpc(user.id)
        || await fetchN8nSubscription(user.id)
        || await fetchClientViaApi(user.id)
        || await fetchSupabaseClient(user.id)
        || await fetchSupabaseSubscription(user.id)
        || await fetchPocketBaseSubscription(user.id)
        || trialFromUser(user);
      setRow(sub);
    } catch (err) {
      setError(err?.message || 'Impossible de charger votre abonnement.');
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchSubscription(); }, [fetchSubscription]);

  return {
    subscription: useMemo(() => computeMetrics(row), [row]),
    loading,
    error,
    notFound: false,
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
  const { user } = useAuth();
  const { subscription, loading, error, refresh } = useSubscription(user);

  const handleSubscribe = () => {
    window.open('https://wa.me/243821386516?text=Bonjour%2C%20je%20souhaite%20m%27abonner%20%C3%A0%20Ash%20Ledger%20Premium.', '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <Helmet>
        <title>Mon abonnement — Ash Ledger</title>
        <meta name="description" content="Consultez votre plan, vos dates et votre statut d'abonnement Ash Ledger." />
      </Helmet>
      <div className="min-h-screen bg-gray-50">
        <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={() => navigate('/chat')} className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 transition-colors" aria-label="Retour">
            <ArrowLeft size={20} strokeWidth={1.8} />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">Mon abonnement</h1>
        </header>
        <main className="max-w-lg mx-auto px-4 py-6">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className="space-y-5">
            {loading && <LoadingSkeleton />}
            {!loading && error && (
              <div className="bg-white rounded-2xl border border-red-100 px-5 py-6 text-center space-y-3">
                <div className="w-12 h-12 mx-auto rounded-full bg-red-50 flex items-center justify-center"><WifiOff size={22} className="text-red-500" /></div>
                <p className="text-sm font-medium text-gray-900">Erreur de connexion</p>
                <p className="text-sm text-gray-500">{error}</p>
                <button type="button" onClick={refresh} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white" style={{ backgroundColor: ACCENT }}>
                  <RefreshCw size={16} /> Réessayer
                </button>
              </div>
            )}
            {!loading && !error && subscription && (
              <>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-5" style={{ background: `linear-gradient(135deg, ${ACCENT}18 0%, #fff 60%)` }}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          {subscription.isPremiumActive && <Crown size={18} style={{ color: ACCENT }} />}
                          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Plan actuel</p>
                        </div>
                        <p className="text-2xl font-bold text-gray-900">{subscription.planLabel}</p>
                      </div>
                      <StatusBadge subscription={subscription} />
                    </div>
                  </div>
                  <div className="px-5 py-4 space-y-4 border-t border-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-gray-600"><Clock size={16} className="text-gray-400" /> Jours restants</div>
                      <span className="text-sm font-semibold text-gray-900">{subscription.daysRemaining} jour{subscription.daysRemaining !== 1 ? 's' : ''}</span>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-gray-500">Utilisation</span>
                        <span className="text-xs font-medium text-gray-700">{subscription.usagePercent}%</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${subscription.usagePercent}%`, backgroundColor: subscription.isExpired ? '#EF4444' : ACCENT }} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="bg-gray-50 rounded-xl px-3 py-2.5">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-0.5"><Calendar size={12} /> Début</div>
                        <p className="text-sm font-medium text-gray-900">{subscription.startDateFormatted}</p>
                      </div>
                      <div className="bg-gray-50 rounded-xl px-3 py-2.5">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-0.5"><Calendar size={12} /> Fin</div>
                        <p className="text-sm font-medium text-gray-900">{subscription.endDateFormatted}</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-5">
                  <p className="text-sm font-semibold text-gray-900 mb-3">Inclus dans votre plan</p>
                  <ul className="space-y-2.5">
                    {FEATURES.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-sm text-gray-600">
                        <CheckCircle2 size={16} className="text-green-500 mt-0.5 flex-shrink-0" /> {f}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="space-y-3 pb-6">
                  {subscription.isTrial && !subscription.isExpired && (
                    <button type="button" onClick={handleSubscribe} className="w-full py-3.5 rounded-xl text-white text-sm font-semibold transition-all active:scale-[0.98]" style={{ backgroundColor: ACCENT, boxShadow: '0 4px 14px rgba(255,107,0,0.25)' }}>
                      S'abonner maintenant
                    </button>
                  )}
                  {subscription.isPremiumActive && (
                    <div className="w-full py-3.5 rounded-xl text-center text-sm font-semibold bg-green-50 text-green-700 border border-green-200">Abonnement actif</div>
                  )}
                  {subscription.isExpired && (
                    <button type="button" onClick={handleSubscribe} className="w-full py-3.5 rounded-xl text-white text-sm font-semibold transition-all active:scale-[0.98] bg-red-500 hover:bg-red-600">
                      Renouveler mon abonnement
                    </button>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </main>
      </div>
    </>
  );
}