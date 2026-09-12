import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { useAuth } from '@/hooks/useAuth';
import { loadActivityConfig } from '@/lib/activityConfig';
import AuthLayout, {
  AuthSubmit,
  Field,
  PasswordInput,
  TextInput,
  friendlyAuthError,
  isValidEmail,
} from '@/components/AuthLayout';
import { BRAND, ASHY_GREETING } from '@/lib/brandAssets';
import pb from '@/lib/pocketbaseClient';

export default function LoginPage() {
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  const validate = () => {
    const next = {};
    if (!form.email.trim()) next.email = 'Entre une adresse e-mail valide.';
    else if (!isValidEmail(form.email)) next.email = 'Entre une adresse e-mail valide.';
    if (!form.password) next.password = 'Entre ton mot de passe.';
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
    try {
      await login(form.email, form.password);
      let destination = '/chat';
      try {
        const config = await loadActivityConfig(pb.authStore.token);
        if (!config.configurationCompleted) destination = '/setup';
      } catch {
        /* chat route guard will retry */
      }
      window.location.replace(destination);
    } catch (err) {
      setServerError(
        friendlyAuthError(err, 'Adresse e-mail ou mot de passe incorrect.'),
      );
      setLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Connexion — Ash Ledger</title>
        <meta name="description" content="Retrouve ton activité avec Ashy." />
      </Helmet>
      <AuthLayout
        mascotSrc={ASHY_GREETING}
        mascotAlt="Ashy, l'assistant financier d'Ash Ledger, te souhaite la bienvenue"
        mascotVariant="welcome"
        intro={
          <>
            <h1 className="text-[26px] font-bold leading-tight tracking-tight sm:text-[28px]">Bon retour 👋</h1>
            <p className="mt-2 text-[15px]" style={{ color: BRAND.textMuted }}>
              Retrouve ton activité avec Ashy.
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
          <Field id="login-email" label="Adresse e-mail" error={errors.email}>
            <TextInput
              id="login-email"
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

          <Field
            id="login-password"
            label="Mot de passe"
            error={errors.password}
            aside={
              <Link
                to="/forgot-password"
                className="text-[13px] font-semibold outline-none hover:underline focus-visible:underline"
                style={{ color: BRAND.navy }}
              >
                Mot de passe oublié ?
              </Link>
            }
          >
            <PasswordInput
              id="login-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
              autoComplete="current-password"
              visible={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
              error={errors.password}
            />
          </Field>

          <AuthSubmit loading={loading} loadingLabel="Connexion...">
            Se connecter
          </AuthSubmit>
        </form>

        <p className="mt-6 text-center text-[14px]" style={{ color: BRAND.textMuted }}>
          Pas encore de compte ?{' '}
          <Link to="/signup" className="font-semibold outline-none hover:underline" style={{ color: BRAND.navy }}>
            Créer un compte
          </Link>
        </p>
      </AuthLayout>
    </>
  );
}
