import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { Eye, EyeOff, Mail, Lock, User } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';

const ASH_LOGO = 'https://horizons-cdn.hostinger.com/29358ba6-568b-49c6-9aac-6ece4b30fac6/a93f12ddd85a0d01d0715ee252158d85.png';

export default function SignupPage() {
  const navigate = useNavigate();
  const { signup } = useAuth();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  const validate = () => {
    const errs = {};
    if (!form.firstName.trim()) errs.firstName = 'Le prénom est obligatoire.';
    if (!form.lastName.trim()) errs.lastName = 'Le nom est obligatoire.';
    if (!form.email) errs.email = "L'adresse e-mail est obligatoire.";
    else if (!/\S+@\S+\.\S+/.test(form.email)) errs.email = 'Veuillez entrer une adresse e-mail valide.';
    if (!form.password) errs.password = 'Le mot de passe est obligatoire.';
    else if (form.password.length < 8) errs.password = 'Le mot de passe doit contenir au moins 8 caractères.';
    if (!form.confirm) errs.confirm = 'Veuillez confirmer votre mot de passe.';
    else if (form.confirm !== form.password) errs.confirm = 'Les mots de passe ne correspondent pas.';
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
      await signup(form.email, form.firstName, form.lastName, form.password);
      navigate('/chat');
    } catch (err) {
      const data = err?.data?.data || err?.response?.data?.data || {};
      const fieldErrors = {};

      if (data.email) {
        const code = data.email.code;
        if (code === 'validation_not_unique') fieldErrors.email = 'Cette adresse e-mail est déjà utilisée. Connectez-vous ou utilisez une autre adresse e-mail.';
        else if (code === 'validation_required') fieldErrors.email = "L'adresse e-mail est obligatoire.";
        else if (code === 'validation_is_email') fieldErrors.email = 'Veuillez entrer une adresse e-mail valide.';
        else fieldErrors.email = data.email.message || 'Erreur sur le champ e-mail.';
      }
      if (data.firstName) {
        fieldErrors.firstName = data.firstName.code === 'validation_required' ? 'Le prénom est obligatoire.' : (data.firstName.message || 'Erreur sur le prénom.');
      }
      if (data.lastName) {
        fieldErrors.lastName = data.lastName.code === 'validation_required' ? 'Le nom est obligatoire.' : (data.lastName.message || 'Erreur sur le nom.');
      }
      if (data.password) {
        const code = data.password.code;
        if (code === 'validation_required') fieldErrors.password = 'Le mot de passe est obligatoire.';
        else if (code === 'validation_length_out_of_range' || code === 'validation_min_text_constraint') fieldErrors.password = 'Le mot de passe doit contenir au moins 8 caractères.';
        else fieldErrors.password = data.password.message || 'Erreur sur le mot de passe.';
      }
      if (data.passwordConfirm) {
        fieldErrors.confirm = 'Les mots de passe ne correspondent pas.';
      }

      if (Object.keys(fieldErrors).length) {
        setErrors(prev => ({ ...prev, ...fieldErrors }));
      } else {
        setServerError(err?.message || 'Une erreur est survenue. Veuillez réessayer.');
      }
    } finally {
      setLoading(false);
    }
  };

  const fieldClass = (key) =>
    `w-full pl-11 pr-4 py-3 rounded-xl border text-sm outline-none transition-all ${errors[key] ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50 focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100'}`;

  return (
    <>
      <Helmet>
        <title>Inscription — Ash Ledger</title>
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
              <h2 className="text-xl font-semibold text-gray-900">Créer un compte</h2>
              <p className="text-sm text-gray-400 mt-0.5">Rejoignez Ash Ledger dès aujourd'hui</p>
            </div>

            {serverError && (
              <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                {serverError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* First + Last name row */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Prénom</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" strokeWidth={1.8} style={{ width: 18, height: 18 }} />
                    <input
                      type="text"
                      value={form.firstName}
                      onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                      placeholder="Prénom"
                      className={fieldClass('firstName')}
                    />
                  </div>
                  {errors.firstName && <p className="mt-1.5 text-xs text-red-500">{errors.firstName}</p>}
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Nom</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" strokeWidth={1.8} style={{ width: 18, height: 18 }} />
                    <input
                      type="text"
                      value={form.lastName}
                      onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                      placeholder="Nom"
                      className={fieldClass('lastName')}
                    />
                  </div>
                  {errors.lastName && <p className="mt-1.5 text-xs text-red-500">{errors.lastName}</p>}
                </div>
              </div>

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
                    className={fieldClass('email')}
                  />
                </div>
                {errors.email && <p className="mt-1.5 text-xs text-red-500">{errors.email}</p>}
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Mot de passe</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" strokeWidth={1.8} style={{ width: 18, height: 18 }} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Minimum 8 caractères"
                    className={`w-full pl-11 pr-11 py-3 rounded-xl border text-sm outline-none transition-all ${errors.password ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50 focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100'}`}
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                    {showPassword ? <EyeOff style={{ width: 18, height: 18 }} strokeWidth={1.8} /> : <Eye style={{ width: 18, height: 18 }} strokeWidth={1.8} />}
                  </button>
                </div>
                {errors.password && <p className="mt-1.5 text-xs text-red-500">{errors.password}</p>}
              </div>

              {/* Confirm */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirmer le mot de passe</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" strokeWidth={1.8} style={{ width: 18, height: 18 }} />
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={form.confirm}
                    onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                    placeholder="Répétez le mot de passe"
                    className={`w-full pl-11 pr-11 py-3 rounded-xl border text-sm outline-none transition-all ${errors.confirm ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50 focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100'}`}
                  />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                    {showConfirm ? <EyeOff style={{ width: 18, height: 18 }} strokeWidth={1.8} /> : <Eye style={{ width: 18, height: 18 }} strokeWidth={1.8} />}
                  </button>
                </div>
                {errors.confirm && <p className="mt-1.5 text-xs text-red-500">{errors.confirm}</p>}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl text-white text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-60 mt-2"
                style={{ backgroundColor: '#FF6B00', boxShadow: '0 4px 14px rgba(255,107,0,0.28)' }}
              >
                {loading ? 'Création en cours…' : 'Créer mon compte'}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-gray-500">
              Déjà un compte ?{' '}
              <Link to="/login" className="font-semibold hover:underline" style={{ color: '#FF6B00' }}>
                Se connecter
              </Link>
            </p>
          </div>
        </motion.div>
      </div>
    </>
  );
}
