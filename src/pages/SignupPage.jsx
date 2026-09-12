import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { useAuth } from '@/hooks/useAuth';
import AuthLayout, {
  AuthSubmit,
  Field,
  PasswordInput,
  TextInput,
  friendlyAuthError,
  isStrongPassword,
  isValidEmail,
  splitFullName,
} from '@/components/AuthLayout';
import { ASHY_EXPLANATION, BRAND } from '@/lib/brandAssets';
import { clearPostSignup, markPostSignup } from '@/lib/postSignup';

export default function SignupPage() {
  const { signup } = useAuth();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  const validate = () => {
    const next = {};
    if (!form.fullName.trim()) next.fullName = 'Entre ton nom.';
    if (!form.email.trim() || !isValidEmail(form.email)) next.email = 'Entre une adresse e-mail valide.';
    if (!form.password) next.password = 'Ton mot de passe doit être plus sécurisé.';
    else if (!isStrongPassword(form.password)) next.password = 'Ton mot de passe doit être plus sécurisé.';
    if (!form.confirm || form.confirm !== form.password) next.confirm = 'Les mots de passe ne correspondent pas.';
    return next;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setServerError('');
    const next = validate();
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    setErrors({});
    setLoading(true);
    markPostSignup();
    try {
      const { firstName, lastName } = splitFullName(form.fullName);
      await signup(form.email, firstName, lastName, form.password);
      window.location.replace('/start');
    } catch (err) {
      clearPostSignup();
      const data = err?.data?.data || err?.response?.data?.data || {};
      const fieldErrors = {};
      if (data.email?.code === 'validation_not_unique') {
        fieldErrors.email = 'Cette adresse e-mail est déjà associée à un compte. Essaie de te connecter.';
      } else if (data.email) {
        fieldErrors.email = 'Entre une adresse e-mail valide.';
      }
      if (data.password) fieldErrors.password = 'Ton mot de passe doit être plus sécurisé.';
      if (data.passwordConfirm) fieldErrors.confirm = 'Les mots de passe ne correspondent pas.';

      if (Object.keys(fieldErrors).length) {
        setErrors(fieldErrors);
      } else {
        setServerError(
          friendlyAuthError(err, 'Impossible de créer le compte pour le moment. Réessaie.'),
        );
      }
      setLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Inscription — Ash Ledger</title>
        <meta name="description" content="Commence ton essai gratuit avec Ash Ledger." />
      </Helmet>
      <AuthLayout
        mascotSrc={ASHY_EXPLANATION}
        mascotAlt="Ashy t'accompagne pour créer ton compte Ash Ledger"
        mascotVariant="start"
        intro={
          <>
            <h1 className="text-[26px] font-bold leading-tight tracking-tight sm:text-[28px]">Créer ton compte</h1>
            <p className="mt-2 text-[15px]" style={{ color: BRAND.textMuted }}>
              Commence ton essai gratuit avec Ash Ledger.
            </p>
          </>
        }
      >
        {serverError ? (
          <div className="mt-1 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-[14px]" style={{ color: BRAND.error }} role="alert">
            {serverError}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 lg:mt-7" autoComplete="on" noValidate>
          <Field id="signup-name" label="Nom complet" error={errors.fullName}>
            <TextInput
              id="signup-name"
              name="name"
              type="text"
              autoComplete="name"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              placeholder="Ex. Marce Ashley"
              error={errors.fullName}
            />
          </Field>

          <Field id="signup-email" label="Adresse e-mail" error={errors.email}>
            <TextInput
              id="signup-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="exemple@email.com"
              error={errors.email}
            />
          </Field>

          <Field id="signup-password" label="Mot de passe" error={errors.password}>
            <PasswordInput
              id="signup-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
              autoComplete="new-password"
              visible={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
              error={errors.password}
            />
          </Field>

          <Field id="signup-confirm" label="Confirmation du mot de passe" error={errors.confirm}>
            <PasswordInput
              id="signup-confirm"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              placeholder="••••••••"
              autoComplete="new-password"
              visible={showConfirm}
              onToggle={() => setShowConfirm((v) => !v)}
              error={errors.confirm}
              toggleLabelShow="Afficher la confirmation"
              toggleLabelHide="Masquer la confirmation"
            />
          </Field>

          <AuthSubmit loading={loading} loadingLabel="Création du compte...">
            Créer mon compte
          </AuthSubmit>
        </form>

        <p className="mt-6 text-center text-[14px]" style={{ color: BRAND.textMuted }}>
          Déjà un compte ?{' '}
          <Link to="/login" className="font-semibold outline-none hover:underline" style={{ color: BRAND.navy }}>
            Se connecter
          </Link>
        </p>
      </AuthLayout>
    </>
  );
}
