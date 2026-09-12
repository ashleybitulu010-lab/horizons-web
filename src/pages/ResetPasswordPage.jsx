import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import pb from '@/lib/pocketbaseClient';
import AuthLayout, {
  AuthSubmit,
  Field,
  PasswordInput,
  friendlyAuthError,
  isStrongPassword,
} from '@/components/AuthLayout';
import { BRAND } from '@/lib/brandAssets';

function readResetToken(searchParams) {
  return (
    searchParams.get('token')
    || new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token')
    || ''
  );
}

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => readResetToken(searchParams), [searchParams]);
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState('');

  const validate = () => {
    const next = {};
    if (!isStrongPassword(form.password)) next.password = 'Ton mot de passe doit être plus sécurisé.';
    if (form.confirm !== form.password) next.confirm = 'Les mots de passe ne correspondent pas.';
    return next;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setServerError('');
    if (!token) {
      setServerError('Ce lien est invalide ou a expiré. Demande un nouveau lien.');
      return;
    }
    const next = validate();
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      await pb.collection('users').confirmPasswordReset(token, form.password, form.confirm);
      setDone(true);
    } catch (err) {
      setServerError(
        friendlyAuthError(err, 'Ce lien est invalide ou a expiré. Demande un nouveau lien.'),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Nouveau mot de passe — Ash Ledger</title>
      </Helmet>
      <AuthLayout>
        {done ? (
          <>
            <h1 className="text-[28px] font-bold leading-tight tracking-tight">Ton mot de passe a été modifié.</h1>
            <p className="mt-3 text-[15px]" style={{ color: BRAND.textMuted }}>
              Tu peux maintenant te connecter avec ton nouveau mot de passe.
            </p>
            <Link
              to="/login"
              className="mt-8 inline-flex h-[54px] w-full items-center justify-center rounded-2xl text-[16px] font-semibold text-white"
              style={{ backgroundColor: BRAND.orange }}
            >
              Se connecter
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-[28px] font-bold leading-tight tracking-tight">Nouveau mot de passe</h1>
            <p className="mt-2 text-[15px]" style={{ color: BRAND.textMuted }}>
              Choisis un mot de passe plus sécurisé pour ton compte.
            </p>

            {serverError ? (
              <div className="mt-5 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-[14px]" style={{ color: BRAND.error }} role="alert">
                {serverError}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-7 space-y-4" autoComplete="on" noValidate>
              <Field id="reset-password" label="Nouveau mot de passe" error={errors.password}>
                <PasswordInput
                  id="reset-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  visible={showPassword}
                  onToggle={() => setShowPassword((v) => !v)}
                  error={errors.password}
                />
              </Field>
              <Field id="reset-confirm" label="Confirmer le nouveau mot de passe" error={errors.confirm}>
                <PasswordInput
                  id="reset-confirm"
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
              <AuthSubmit loading={loading} loadingLabel="Modification...">
                Modifier mon mot de passe
              </AuthSubmit>
            </form>
          </>
        )}
      </AuthLayout>
    </>
  );
}
