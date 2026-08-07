import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  ChevronRight,
  CircleDollarSign,
  Eye,
  EyeOff,
  Globe,
  Lock,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import pb from '@/lib/pocketbaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import { persistRelaunchGuide, readOnboardingState } from '@/hooks/useOnboarding';
import {
  loadCurrencyPreference,
  saveCurrencyPreference,
} from '@/lib/currency';

function Toast({ message, onDismiss }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [message, onDismiss]);
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-lg text-sm font-medium max-w-xs text-center ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {message.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SectionTitle({ children }) {
  return (
    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1 mb-2">{children}</p>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${
        checked ? 'bg-orange-500' : 'bg-gray-200'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function Input({ label, value, onChange, type = 'text', right }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-xs font-semibold text-gray-500">{label}</label>}
      <div className="relative flex items-center">
        <input
          type={type}
          value={value}
          onChange={onChange}
          className={`w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-800 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-all ${right ? 'pr-11' : ''}`}
        />
        {right && <div className="absolute right-3">{right}</div>}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [language, setLanguage] = useState('fr');
  const [currency, setCurrency] = useState('USD');
  const [currencyClientId, setCurrencyClientId] = useState(null);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [toast, setToast] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [guideStatus, setGuideStatus] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    setLoading(true);

    const profileRequest = pb.collection('users').getOne(user.id);
    const currencyRequest = token
      ? loadCurrencyPreference(token, user.id)
      : Promise.reject(new Error('Missing authentication token'));

    Promise.allSettled([profileRequest, currencyRequest])
      .then(([profileResult, currencyResult]) => {
        if (!active) return;
        if (profileResult.status === 'fulfilled') {
          setNotifications(profileResult.value.notifications_enabled !== false);
          setLanguage(profileResult.value.language || 'fr');
        }
        if (currencyResult.status === 'fulfilled') {
          setCurrencyClientId(currencyResult.value.clientId);
          setCurrency(currencyResult.value.currency || currencyResult.value.displayCurrency);
        } else {
          setToast({ type: 'error', text: 'Impossible de charger votre devise.' });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const onboarding = readOnboardingState(user.id);
    setGuideStatus(onboarding?.status || 'pending');
    return () => { active = false; };
  }, [user?.id, token]);

  const relaunchGuide = () => {
    if (!user?.id) return;
    persistRelaunchGuide(user.id);
    setGuideStatus('pending');
    setToast({ type: 'success', text: 'Guide Ashy ouvert…' });
    navigate('/chat?guide=1');
  };

  const savePreferences = async () => {
    setSaving(true);
    try {
      await pb.collection('users').update(user.id, {
        notifications_enabled: notifications,
        language,
      });
      let clientId = currencyClientId;
      if (!clientId) {
        const preference = await loadCurrencyPreference(token, user.id);
        clientId = preference.clientId;
        setCurrencyClientId(clientId);
      }
      const savedCurrency = await saveCurrencyPreference({
        clientId,
        userId: user.id,
        currency,
      });
      setCurrency(savedCurrency.currency || savedCurrency.displayCurrency);
      setToast({ type: 'success', text: 'Préférences enregistrées !' });
    } catch {
      setToast({ type: 'error', text: 'Erreur lors de l\'enregistrement.' });
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (!oldPwd) { setToast({ type: 'error', text: 'Saisissez votre ancien mot de passe.' }); return; }
    if (newPwd.length < 8) { setToast({ type: 'error', text: 'Le mot de passe doit contenir au moins 8 caractères.' }); return; }
    if (newPwd !== confirmPwd) { setToast({ type: 'error', text: 'Les mots de passe ne correspondent pas.' }); return; }
    setSavingPwd(true);
    try {
      await pb.collection('users').update(user.id, {
        oldPassword: oldPwd,
        password: newPwd,
        passwordConfirm: confirmPwd,
      });
      setToast({ type: 'success', text: 'Mot de passe modifié avec succès !' });
      setOldPwd(''); setNewPwd(''); setConfirmPwd('');
    } catch (err) {
      const msg = err?.response?.data?.oldPassword?.message || 'Ancien mot de passe incorrect.';
      setToast({ type: 'error', text: msg });
    } finally {
      setSavingPwd(false);
    }
  };

  const deleteAccount = async () => {
    if (deleteConfirmText !== 'SUPPRIMER') {
      setToast({ type: 'error', text: 'Veuillez saisir "SUPPRIMER" pour confirmer.' });
      return;
    }
    setDeleting(true);
    try {
      await pb.collection('users').delete(user.id);
      await logout();
      navigate('/login', { replace: true });
    } catch {
      setToast({ type: 'error', text: 'Erreur lors de la suppression du compte.' });
      setDeleting(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Paramètres — Ash Ledger</title>
        <meta name="description" content="Gérez vos paramètres Ash Ledger." />
      </Helmet>

      <Toast message={toast} onDismiss={() => setToast(null)} />

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
              onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="fixed inset-0 z-50 flex items-center justify-center px-4"
            >
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle size={20} className="text-red-500" strokeWidth={2} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">Supprimer mon compte</h3>
                    <p className="text-xs text-gray-400">Cette action est irréversible</p>
                  </div>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed mb-4">
                  Toutes vos données seront définitivement supprimées. Tapez{' '}
                  <strong className="text-red-500 font-bold">SUPPRIMER</strong> pour confirmer.
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={e => setDeleteConfirmText(e.target.value)}
                  placeholder="SUPPRIMER"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-center font-bold text-red-500 tracking-widest outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 mb-4"
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }}
                    className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={deleteAccount}
                    disabled={deleting || deleteConfirmText !== 'SUPPRIMER'}
                    className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
                  >
                    {deleting ? 'Suppression…' : 'Supprimer'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="min-h-[100dvh] flex flex-col" style={{ backgroundColor: '#F5F1EB' }}>
        <header
          className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
          style={{ backgroundColor: '#FF6B00', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
        >
          <button
            onClick={() => navigate('/chat')}
            className="w-9 h-9 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors active:scale-95"
          >
            <ArrowLeft size={20} strokeWidth={2} />
          </button>
          <h1 className="text-white font-semibold text-base flex-1">Paramètres</h1>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6 max-w-lg mx-auto w-full space-y-6">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 rounded-full border-2 border-orange-400 border-t-transparent animate-spin" />
            </div>
          ) : (
            <>
              {/* Ashy guide */}
              <div>
                <SectionTitle>Guide Ashy</SectionTitle>
                <div className="bg-white rounded-2xl shadow-sm">
                  <button
                    type="button"
                    onClick={relaunchGuide}
                    className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-orange-50/60 transition-colors rounded-2xl"
                  >
                    <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
                      <Sparkles size={17} className="text-orange-500" strokeWidth={1.8} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">Relancer le guide interactif</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {guideStatus === 'completed'
                          ? 'Revoir les bases avec Ashy (produit → stock → vente…)'
                          : guideStatus === 'skipped'
                            ? 'Vous avez passé le guide — vous pouvez le reprendre ici'
                            : guideStatus === 'active'
                              ? 'Guide en cours — reprendre avec Ashy'
                              : 'Découvrir Ash Ledger en moins de 5 minutes'}
                      </p>
                    </div>
                    <ChevronRight size={18} className="text-gray-300 flex-shrink-0" />
                  </button>
                </div>
              </div>

              {/* Preferences */}
              <div>
                <SectionTitle>Préférences</SectionTitle>
                <div className="bg-white rounded-2xl shadow-sm divide-y divide-gray-50">
                  {/* Notifications */}
                  <div className="flex items-center gap-4 px-5 py-4">
                    <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
                      <Bell size={17} className="text-orange-400" strokeWidth={1.8} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-800">Notifications</p>
                      <p className="text-xs text-gray-400 mt-0.5">Recevoir des alertes et mises à jour</p>
                    </div>
                    <Toggle checked={notifications} onChange={setNotifications} />
                  </div>

                  {/* Language */}
                  <div className="flex items-center gap-4 px-5 py-4">
                    <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
                      <Globe size={17} className="text-orange-400" strokeWidth={1.8} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-800">Langue</p>
                      <p className="text-xs text-gray-400 mt-0.5">Langue de l'interface</p>
                    </div>
                    <select
                      value={language}
                      onChange={e => setLanguage(e.target.value)}
                      className="text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 outline-none focus:border-orange-400 cursor-pointer"
                    >
                      <option value="fr">Français</option>
                      <option value="en">English</option>
                    </select>
                  </div>

                  {/* Currency — single unit for tables + dashboard */}
                  <div className="flex items-center gap-4 px-5 py-4">
                    <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
                      <CircleDollarSign size={17} className="text-orange-400" strokeWidth={1.8} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-800">Devise</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Unique pour le tableau de bord, les tables et les rapports
                      </p>
                    </div>
                    <select
                      value={currency}
                      onChange={e => setCurrency(e.target.value)}
                      className="text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 outline-none focus:border-orange-400 cursor-pointer"
                    >
                      <option value="USD">USD ($)</option>
                      <option value="CDF">CDF (FC)</option>
                    </select>
                  </div>
                </div>

                <button
                  onClick={savePreferences}
                  disabled={saving}
                  className="mt-3 w-full py-3 rounded-xl text-white text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
                  style={{ backgroundColor: '#FF6B00' }}
                >
                  {saving && <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                  {saving ? 'Enregistrement…' : 'Enregistrer les préférences'}
                </button>
              </div>

              {/* Password */}
              <div>
                <SectionTitle>Sécurité</SectionTitle>
                <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
                      <Lock size={17} className="text-orange-400" strokeWidth={1.8} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">Modifier le mot de passe</p>
                    </div>
                  </div>
                  <Input
                    label="Ancien mot de passe"
                    type={showOld ? 'text' : 'password'}
                    value={oldPwd}
                    onChange={e => setOldPwd(e.target.value)}
                    right={
                      <button onClick={() => setShowOld(v => !v)} className="text-gray-400 hover:text-gray-600">
                        {showOld ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    }
                  />
                  <Input
                    label="Nouveau mot de passe"
                    type={showNew ? 'text' : 'password'}
                    value={newPwd}
                    onChange={e => setNewPwd(e.target.value)}
                    right={
                      <button onClick={() => setShowNew(v => !v)} className="text-gray-400 hover:text-gray-600">
                        {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    }
                  />
                  <Input
                    label="Confirmer le mot de passe"
                    type="password"
                    value={confirmPwd}
                    onChange={e => setConfirmPwd(e.target.value)}
                  />
                  <button
                    onClick={changePassword}
                    disabled={savingPwd}
                    className="w-full py-3 rounded-xl text-white text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
                    style={{ backgroundColor: '#FF6B00' }}
                  >
                    {savingPwd && <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                    {savingPwd ? 'Modification…' : 'Modifier le mot de passe'}
                  </button>
                </div>
              </div>

              {/* Danger zone */}
              <div>
                <SectionTitle>Zone de danger</SectionTitle>
                <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full flex items-center gap-4 px-5 py-4 hover:bg-red-50 transition-colors group"
                  >
                    <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0 group-hover:bg-red-100 transition-colors">
                      <Trash2 size={17} className="text-red-400" strokeWidth={1.8} />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-semibold text-red-600">Supprimer mon compte</p>
                      <p className="text-xs text-gray-400 mt-0.5">Action irréversible — toutes vos données seront perdues</p>
                    </div>
                    <ChevronRight size={16} className="text-gray-300 group-hover:text-red-400 transition-colors" />
                  </button>
                </div>
              </div>

              <div className="pb-4" />
            </>
          )}
        </div>
      </div>
    </>
  );
}
