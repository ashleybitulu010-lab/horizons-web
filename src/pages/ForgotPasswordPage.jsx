import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import pb from '@/lib/pocketbaseClient';
import AuthLayout, {
  AuthSubmit,
  Field,
  TextInput,
  friendlyAuthError,
  isValidEmail,
} from '@/components/AuthLayout';
import { BRAND } from '@/lib/brandAssets';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    const trimmed = email.trim();
    if (!trimmed || !isValidEmail(trimmed)) {
      setError('Entre une adresse e-mail valide.');
      return;
    }
    setLoading(true);
    try {
      await pb.collection('users').requestPasswordReset(trimmed);
      setSent(true);
    } catch (err) {
      setError(
        friendlyAuthError(err, 'Impossible de contacter le serveur. Vérifie ta connexion puis réessaie.'),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Réinitialiser le mot de passe — Ash Ledger</title>
      </Helmet>
      <AuthLayout>
        {sent ? (
          <>
            <h1 className="text-[28px] font-bold leading-tight tracking-tight">Vérifie ta boîte mail 📩</h1>
            <p className="mt-3 text-[15px] leading-relaxed" style={{ color: BRAND.textMuted }}>
              Si cette adresse correspond à un compte, tu recevras les instructions.
            </p>
            <Link
              to="/login"
              className="mt-8 inline-flex min-h-11 items-center font-semibold outline-none hover:underline"
              style={{ color: BRAND.navy }}
            >
              Se connecter
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-[28px] font-bold leading-tight tracking-tight">Réinitialiser ton mot de passe</h1>
            <p className="mt-2 text-[15px] leading-relaxed" style={{ color: BRAND.textMuted }}>
              Entre ton adresse e-mail et nous t&apos;enverrons un lien pour créer un nouveau mot de passe.
            </p>

            {error ? (
              <div className="mt-5 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-[14px]" style={{ color: BRAND.error }} role="alert">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-7 space-y-4" autoComplete="on" noValidate>
              <Field id="forgot-email" label="Adresse e-mail" error={error && !email ? error : undefined}>
                <TextInput
                  id="forgot-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="exemple@email.com"
                />
              </Field>
              <AuthSubmit loading={loading} loadingLabel="Envoi...">
                Envoyer le lien
              </AuthSubmit>
            </form>

            <p className="mt-6 text-center text-[14px]" style={{ color: BRAND.textMuted }}>
              <Link to="/login" className="font-semibold outline-none hover:underline" style={{ color: BRAND.navy }}>
                Retour à la connexion
              </Link>
            </p>
          </>
        )}
      </AuthLayout>
    </>
  );
}
