import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { Eye, EyeOff, Mail, Lock } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';

const ASH_LOGO = 'https://horizons-cdn.hostinger.com/29358ba6-568b-49c6-9aac-6ece4b30fac6/a93f12ddd85a0d01d0715ee252158d85.png';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  const validate = () => {
    const errs = {};
    if (!form.email) errs.email = 'L\'email est requis';
    else if (!/\S+@\S+\.\S+/.test(form.email)) errs.email = 'Email invalide';
    if (!form.password) errs.password = 'Le mot de passe est requis';
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError('');
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate('/chat');
    } catch (err) {
      setServerError(err?.message || 'Email ou mot de passe incorrect.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Connexion — Ash Ledger</title>
        <meta name="description" content="Gérez vos finances, ventes, dépenses, stocks et rapports grâce à l'intelligence artificielle." />
      </Helmet>
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
        <motion.div
          className="w-full max-w-md"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Branding */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-32 h-32 rounded-full bg-white flex items-center justify-center mb-4 shadow-[0_4px_14px_rgba(0,0,0,0.1)] border border-gray-100 overflow-hidden">
              <img src={ASH_LOGO} alt="Ash Ledger" className="w-32 h-32 object-cover" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight" translate="no">Ash Ledger</h1>
            <p className="text-sm text-gray-400 mt-1">Votre assistant financier intelligent</p>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-8 py-8">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900">Bon retour</h2>
              <p className="text-sm text-gray-400 mt-0.5">Connectez-vous à votre espace</p>
            </div>

            {serverError && (
              <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                {serverError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Adresse email</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" strokeWidth={1.8} style={{ width: 18, height: 18 }} />
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="vous@exemple.com"
                    className={`w-full pl-11 pr-4 py-3 rounded-xl border text-sm outline-none transition-all ${errors.email ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50 focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100'}`}
                  />
                </div>
                {errors.email && <p className="mt-1.5 text-xs text-red-500">{errors.email}</p>}
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">Mot de passe</label>
                  <Link to="/forgot-password" className="text-xs font-medium hover:underline" style={{ color: '#FF6B00' }}>Mot de passe oublié ?</Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" strokeWidth={1.8} style={{ width: 18, height: 18 }} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Votre mot de passe"
                    className={`w-full pl-11 pr-11 py-3 rounded-xl border text-sm outline-none transition-all ${errors.password ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50 focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100'}`}
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                    {showPassword ? <EyeOff style={{ width: 18, height: 18 }} strokeWidth={1.8} /> : <Eye style={{ width: 18, height: 18 }} strokeWidth={1.8} />}
                  </button>
                </div>
                {errors.password && <p className="mt-1.5 text-xs text-red-500">{errors.password}</p>}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl text-white text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-60 mt-2"
                style={{ backgroundColor: '#FF6B00', boxShadow: '0 4px 14px rgba(255,107,0,0.28)' }}
              >
                {loading ? 'Connexion en cours…' : 'Se connecter'}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-gray-500">
              Pas encore de compte ?{' '}
              <Link to="/signup" className="font-semibold hover:underline" style={{ color: '#FF6B00' }}>
                Créer un compte
              </Link>
            </p>
          </div>
        </motion.div>
      </div>
    </>
  );
}
