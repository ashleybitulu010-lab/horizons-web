import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';
import pb from '@/lib/pocketbaseClient';

const ASH_LOGO = 'https://horizons-cdn.hostinger.com/29358ba6-568b-49c6-9aac-6ece4b30fac6/a93f12ddd85a0d01d0715ee252158d85.png';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const trimmed = email.trim();
    if (!trimmed) {
      setError('L’email est requis.');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(trimmed)) {
      setError('Email invalide.');
      return;
    }
    setLoading(true);
    try {
      await pb.collection('users').requestPasswordReset(trimmed);
      setSent(true);
    } catch (err) {
      setError(
        err?.message
          || 'Impossible d’envoyer l’email de réinitialisation. Vérifiez l’adresse ou réessayez.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Mot de passe oublié — Ash Ledger</title>
        <meta name="description" content="Réinitialisez votre mot de passe Ash Ledger." />
      </Helmet>
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
        <motion.div
          className="w-full max-w-md"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-28 h-28 rounded-full bg-white flex items-center justify-center mb-4 shadow-[0_4px_14px_rgba(0,0,0,0.1)] border border-gray-100 overflow-hidden">
              <img src={ASH_LOGO} alt="Ash Ledger" className="w-28 h-28 object-cover" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Mot de passe oublié</h1>
            <p className="text-sm text-gray-400 mt-1 text-center">
              Nous vous enverrons un lien de réinitialisation
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-8 py-8">
            {sent ? (
              <div className="text-center space-y-4">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <CheckCircle2 size={28} />
                </span>
                <h2 className="text-lg font-semibold text-gray-900">Email envoyé</h2>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Si un compte existe pour <strong>{email.trim()}</strong>, vous recevrez un lien
                  pour créer un nouveau mot de passe. Vérifiez aussi vos spams.
                </p>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-2 text-sm font-semibold hover:underline"
                  style={{ color: '#FF6B00' }}
                >
                  <ArrowLeft size={16} />
                  Retour à la connexion
                </Link>
              </div>
            ) : (
              <>
                {error && (
                  <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                    {error}
                  </div>
                )}
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Adresse email
                    </label>
                    <div className="relative">
                      <Mail
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                        strokeWidth={1.8}
                        style={{ width: 18, height: 18 }}
                      />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="vous@exemple.com"
                        className="w-full pl-11 pr-4 py-3 rounded-xl border text-sm outline-none transition-all border-gray-200 bg-gray-50 focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 rounded-xl text-white text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-60"
                    style={{ backgroundColor: '#FF6B00', boxShadow: '0 4px 14px rgba(255,107,0,0.28)' }}
                  >
                    {loading ? 'Envoi…' : 'Envoyer le lien'}
                  </button>
                </form>
                <p className="mt-6 text-center text-sm text-gray-500">
                  <Link to="/login" className="font-semibold hover:underline" style={{ color: '#FF6B00' }}>
                    Retour à la connexion
                  </Link>
                </p>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}
