import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { ArrowLeft, Save, Eye, EyeOff, Camera } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/context/LanguageContext';
import pb from '@/lib/pocketbaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import { cleanUtf8Text } from '@/lib/textEncoding';

function Toast({ message, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-lg text-sm font-medium ${
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

function Input({ label, value, onChange, type = 'text', readOnly = false, right }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</label>
      <div className="relative flex items-center">
        <input
          type={type}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          className={`w-full px-4 py-3 rounded-xl border text-sm outline-none transition-all ${
            readOnly
              ? 'bg-gray-50 text-gray-400 border-gray-100 cursor-default'
              : 'bg-white text-gray-800 border-gray-200 focus:border-orange-400 focus:ring-2 focus:ring-orange-100'
          } ${right ? 'pr-11' : ''}`}
        />
        {right && <div className="absolute right-3">{right}</div>}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { user, updateUserRecord } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [profile, setProfile] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    pb.collection('users').getOne(user.id)
      .then((rec) => {
        setProfile(rec);
        setFirstName(cleanUtf8Text(rec.firstName || ''));
        setLastName(cleanUtf8Text(rec.lastName || ''));
      })
      .catch(() => setToast({ type: 'error', text: 'Erreur lors du chargement du profil.' }))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const saveProfile = async () => {
    setSaving(true);
    try {
      const updated = await pb.collection('users').update(user.id, { firstName, lastName });
      setProfile(updated);
      updateUserRecord(updated);
      setToast({ type: 'success', text: 'Profil mis à jour avec succès !' });
    } catch {
      setToast({ type: 'error', text: 'Erreur lors de la mise à jour du profil.' });
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (!oldPassword) {
      setToast({ type: 'error', text: 'Veuillez saisir votre ancien mot de passe.' });
      return;
    }
    if (newPassword.length < 8) {
      setToast({ type: 'error', text: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setToast({ type: 'error', text: 'Les mots de passe ne correspondent pas.' });
      return;
    }
    setSavingPwd(true);
    try {
      await pb.collection('users').update(user.id, {
        oldPassword,
        password: newPassword,
        passwordConfirm: confirmPassword,
      });
      setToast({ type: 'success', text: 'Mot de passe modifié avec succès !' });
      setOldPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err) {
      const msg = err?.response?.data?.oldPassword?.message || 'Ancien mot de passe incorrect ou erreur serveur.';
      setToast({ type: 'error', text: msg });
    } finally {
      setSavingPwd(false);
    }
  };

  const uploadAvatar = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !user?.id) return;
    if (!file.type.startsWith('image/')) {
      setToast({ type: 'error', text: 'Choisissez une image (JPG, PNG ou WebP).' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setToast({ type: 'error', text: 'La photo doit faire moins de 2 Mo.' });
      return;
    }
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const updated = await pb.collection('users').update(user.id, formData);
      setProfile(updated);
      updateUserRecord(updated);
      setToast({ type: 'success', text: 'Photo de profil mise à jour !' });
    } catch {
      setToast({ type: 'error', text: 'Impossible de mettre à jour la photo de profil.' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const avatarUrl = profile?.avatar
    ? pb.files.getURL(profile, profile.avatar)
    : null;

  const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || '?';

  const formatDate = (d) =>
    d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

  return (
    <>
      <Helmet>
        <title>{t('profile.title')} — Ash Ledger</title>
        <meta name="description" content="Gérez votre profil Ash Ledger." />
      </Helmet>

      <Toast message={toast} onDismiss={() => setToast(null)} />

      <div className="min-h-[100dvh] flex flex-col" style={{ backgroundColor: '#F5F1EB' }}>
        {/* Header */}
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
          <h1 className="text-white font-semibold text-base flex-1">{t('profile.title')}</h1>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6 max-w-lg mx-auto w-full space-y-5">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 rounded-full border-2 border-orange-400 border-t-transparent animate-spin" />
            </div>
          ) : (
            <>
              {/* Avatar */}
              <div className="flex flex-col items-center gap-3 py-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={uploadAvatar}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="relative group disabled:opacity-60"
                  aria-label="Modifier la photo de profil"
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Avatar" className="w-20 h-20 rounded-full object-cover border-4 border-white shadow-md" />
                  ) : (
                    <div
                      className="w-20 h-20 rounded-full border-4 border-white shadow-md flex items-center justify-center text-2xl font-bold text-white"
                      style={{ backgroundColor: '#FF6B00' }}
                    >
                      {initials}
                    </div>
                  )}
                  <div className="absolute bottom-0 right-0 w-7 h-7 bg-orange-500 rounded-full flex items-center justify-center shadow border-2 border-white text-white">
                    <Camera size={13} />
                  </div>
                </button>
                <p className="text-xs text-gray-400">
                  {uploadingAvatar ? 'Téléversement…' : 'Appuyez pour modifier votre photo'}
                </p>
              </div>

              {/* Profile info card */}
              <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
                <h2 className="text-sm font-bold text-gray-700 mb-1">Informations personnelles</h2>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Prénom" value={firstName} onChange={e => setFirstName(e.target.value)} />
                  <Input label="Nom" value={lastName} onChange={e => setLastName(e.target.value)} />
                </div>
                <Input label="Adresse e-mail" value={profile?.email || ''} readOnly />
                <Input label="Membre depuis" value={formatDate(profile?.created)} readOnly />

                <button
                  onClick={saveProfile}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-60"
                  style={{ backgroundColor: '#FF6B00' }}
                >
                  {saving ? (
                    <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  ) : (
                    <Save size={16} strokeWidth={2} />
                  )}
                  {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
                </button>
              </div>

              {/* Password change card */}
              <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
                <h2 className="text-sm font-bold text-gray-700 mb-1">Modifier le mot de passe</h2>

                <Input
                  label="Ancien mot de passe"
                  type={showOld ? 'text' : 'password'}
                  value={oldPassword}
                  onChange={e => setOldPassword(e.target.value)}
                  right={
                    <button onClick={() => setShowOld(v => !v)} className="text-gray-400 hover:text-gray-600">
                      {showOld ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                />
                <Input
                  label="Nouveau mot de passe"
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  right={
                    <button onClick={() => setShowNew(v => !v)} className="text-gray-400 hover:text-gray-600">
                      {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                />
                <Input
                  label="Confirmer le nouveau mot de passe"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                />

                <button
                  onClick={changePassword}
                  disabled={savingPwd}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-60"
                  style={{ backgroundColor: '#FF6B00' }}
                >
                  {savingPwd ? (
                    <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  ) : null}
                  {savingPwd ? 'Modification…' : 'Modifier le mot de passe'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
