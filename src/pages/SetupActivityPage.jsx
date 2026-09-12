import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate } from 'react-router-dom';
import SetupLayout, {
  ChoiceCards,
  ReviewRow,
  SetupField,
  SetupSubmit,
  SetupTextInput,
  YesNoCards,
} from '@/components/SetupLayout';
import { useAuth } from '@/hooks/useAuth';
import { ASHY_EXPLANATION, BRAND } from '@/lib/brandAssets';
import { clearPostSignup } from '@/lib/postSignup';
import {
  AVAILABLE_ACTIVITY_TYPES,
  CURRENCY_OPTIONS,
  activityTypeLabel,
  currencyLabel,
  emptyActivityForm,
  loadActivityConfig,
  readSetupDraft,
  saveActivityConfig,
  validateStep1,
  writeSetupDraft,
  yesNoLabel,
} from '@/lib/activityConfig';

function usableActivityType(value) {
  return AVAILABLE_ACTIVITY_TYPES.some((type) => type.id === value) ? value : '';
}

function ActivityTypeChoice({ value, onChange }) {
  return (
    <div className="space-y-2">
      <p className="text-[13px] leading-snug" style={{ color: BRAND.textMuted }}>
        Choisis ce qui correspond le mieux à ton activité.
      </p>
      {AVAILABLE_ACTIVITY_TYPES.map((type) => {
        const selected = value === type.id;
        return (
          <button
            key={type.id}
            type="button"
            onClick={() => onChange(type.id)}
            className="flex w-full max-w-md flex-col items-start rounded-2xl border px-4 py-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#FF7000] focus-visible:ring-offset-2"
            style={{
              borderColor: selected ? BRAND.orange : '#DDE2EA',
              backgroundColor: selected ? '#FFF4EB' : '#FFFFFF',
              boxShadow: selected ? '0 0 0 1px rgba(255,112,0,0.18)' : 'none',
            }}
            aria-pressed={selected}
          >
            <span className="text-[15px] font-semibold" style={{ color: selected ? BRAND.navy : BRAND.text }}>
              {type.label}
            </span>
            {type.description ? (
              <span className="mt-0.5 text-[13px] leading-snug" style={{ color: BRAND.textMuted }}>
                {type.description}
              </span>
            ) : null}
          </button>
        );
      })}
      <p className="text-[12px] leading-snug" style={{ color: BRAND.textFaint }}>
        D&apos;autres types d&apos;activités seront disponibles prochainement.
      </p>
    </div>
  );
}

export default function SetupActivityPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(emptyActivityForm);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');

  useEffect(() => {
    clearPostSignup();
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      try {
        const config = await loadActivityConfig(token);
        if (cancelled) return;
        if (config.configurationCompleted) {
          navigate('/chat', { replace: true });
          return;
        }

        const draft = readSetupDraft();
        if (draft?.form) {
          setForm({ ...emptyActivityForm(), ...draft.form, typeActivite: usableActivityType(draft.form.typeActivite) });
          setStep(draft.step === 2 ? 2 : 1);
        } else if (config.form.nomActivite || config.form.typeActivite) {
          setForm({ ...config.form, typeActivite: usableActivityType(config.form.typeActivite) });
        }
      } catch {
        if (!cancelled) {
          setServerError('Impossible de charger ta configuration. Vérifie ta connexion puis réessaie.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  const canContinue = useMemo(() => {
    return Boolean(
      form.nomActivite.trim()
      && form.typeActivite
      && form.currency
      && form.gestionStock !== null
      && form.suiviDettes !== null,
    );
  }, [form]);

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setServerError('');
  };

  const handleContinue = () => {
    const nextErrors = validateStep1(form);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    writeSetupDraft(form, 2);
    setStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFinish = async () => {
    const nextErrors = validateStep1(form);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      setStep(1);
      return;
    }

    setSaving(true);
    setServerError('');
    try {
      await saveActivityConfig(token, form);
      navigate('/chat', { replace: true });
    } catch (err) {
      setServerError(
        err?.message?.includes('connexion') || err?.message?.includes('fetch')
          ? 'Impossible d\'enregistrer pour le moment. Vérifie ta connexion puis réessaie.'
          : (err?.message || 'Impossible d\'enregistrer ta configuration. Réessaie.'),
      );
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center" style={{ backgroundColor: '#F8FAFD' }}>
        <p className="text-[14px]" style={{ color: '#687386' }}>Chargement...</p>
      </div>
    );
  }

  if (step === 1) {
    return (
      <>
        <Helmet>
          <title>Configuration — Ash Ledger</title>
        </Helmet>
        <SetupLayout
          step={1}
          title="Parlons de ton activité 👋"
          subtitle="Quelques informations pour qu'Ashy puisse mieux organiser ton espace."
          mascotSrc={ASHY_EXPLANATION}
          mascotAlt="Ashy t'accompagne pour configurer ton activité"
          mascotVariant="start"
        >
          {serverError ? (
            <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-[14px]" style={{ color: '#D64545' }} role="alert">
              {serverError}
            </div>
          ) : null}

          <div className="space-y-5">
            <SetupField label="Nom de ton activité" error={errors.nomActivite}>
              <SetupTextInput
                id="setup-activity-name"
                value={form.nomActivite}
                onChange={(e) => updateField('nomActivite', e.target.value)}
                placeholder="Ex. Boutique Marce"
                error={errors.nomActivite}
              />
            </SetupField>

            <SetupField label="Quel type d'activité exerces-tu ?" error={errors.typeActivite}>
              <ActivityTypeChoice
                value={form.typeActivite}
                onChange={(value) => updateField('typeActivite', value)}
              />
            </SetupField>

            <SetupField label="Quelle devise utilises-tu principalement ?" error={errors.currency}>
              <ChoiceCards
                options={CURRENCY_OPTIONS}
                value={form.currency}
                onChange={(value) => updateField('currency', value)}
              />
            </SetupField>

            <SetupField label="Tu gères du stock ?" error={errors.gestionStock}>
              <YesNoCards
                value={form.gestionStock}
                onChange={(value) => updateField('gestionStock', value)}
              />
            </SetupField>

            <SetupField label="Tu suis les dettes ou crédits clients ?" error={errors.suiviDettes}>
              <YesNoCards
                value={form.suiviDettes}
                onChange={(value) => updateField('suiviDettes', value)}
              />
            </SetupField>
          </div>

          <SetupSubmit onClick={handleContinue} disabled={!canContinue}>
            Continuer
          </SetupSubmit>
        </SetupLayout>
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>Vérification — Ash Ledger</title>
      </Helmet>
      <SetupLayout
        step={2}
        title="Tout est prêt !"
        subtitle="Vérifie rapidement les informations de ton activité avant de commencer."
      >
        {serverError ? (
          <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-[14px]" style={{ color: '#D64545' }} role="alert">
            {serverError}
          </div>
        ) : null}

        <div className="rounded-[16px] bg-white px-4 py-1 shadow-[0_1px_3px_rgba(23,32,51,0.04)]">
          <ReviewRow label="Nom de l'activité" value={form.nomActivite.trim()} />
          <ReviewRow label="Type d'activité" value={activityTypeLabel(form.typeActivite)} />
          <ReviewRow label="Devise principale" value={currencyLabel(form.currency)} />
          <ReviewRow label="Gestion du stock" value={yesNoLabel(form.gestionStock)} />
          <ReviewRow label="Dettes / crédits clients" value={yesNoLabel(form.suiviDettes)} />
        </div>

        <button
          type="button"
          onClick={() => setStep(1)}
          className="mt-4 text-[14px] font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#FF7000]"
          style={{ color: '#173873' }}
        >
          Modifier
        </button>

        <SetupSubmit onClick={handleFinish} loading={saving}>
          Entrer dans mon espace
        </SetupSubmit>
        <p className="mt-2.5 text-[13px]" style={{ color: '#9AA3B2' }}>
          Tu pourras modifier ces informations plus tard.
        </p>
      </SetupLayout>
    </>
  );
}
