import { useState } from 'react';
import { Helmet } from 'react-helmet';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import BrandIcon from '@/components/BrandIcon';
import AshyStage from '@/components/AshyStage';
import { useAuth } from '@/hooks/useAuth';
import { ASHY_EXPLANATION, ASHY_GREETING, ASHY_WELCOME, BRAND, LOGO_SYMBOL } from '@/lib/brandAssets';
import { isIntroGuideCompleted, markIntroGuideCompleted } from '@/lib/introGuide';

const STEPS = [
  {
    title: 'Parle simplement à Ashy 💬',
    text: 'Écris naturellement ce que tu fais dans ton activité.',
    mascot: ASHY_GREETING,
    mascotAlt: 'Ashy t\'écoute et t\'accueille',
    mascotVariant: 'welcome',
  },
  {
    title: 'Ashy organise pour toi ✨',
    text: 'Tes messages deviennent automatiquement des informations faciles à retrouver.',
    mascot: ASHY_EXPLANATION,
    mascotAlt: 'Ashy organise tes informations',
    mascotVariant: 'start',
  },
  {
    title: 'Tout reste organisé 📊',
    text: 'Retrouve tes ventes, dépenses, stocks, dettes et rapports dans ton espace Ash Ledger.',
    mascot: ASHY_WELCOME,
    mascotAlt: 'Ashy te présente ton espace organisé',
    mascotVariant: 'welcome',
  },
  {
    title: 'On commence ? 🚀',
    text: 'Ashy va maintenant configurer ton espace selon ton activité.',
    mascot: ASHY_GREETING,
    mascotAlt: 'Ashy est prêt à configurer ton espace',
    mascotVariant: 'welcome',
  },
];

const ORGANIZE_ITEMS = [
  { icon: 'vente', label: 'Vente' },
  { icon: 'graph', label: 'Dépense' },
  { icon: 'stock', label: 'Stock' },
  { icon: 'dette', label: 'Dette' },
];

const SPACE_ITEMS = [
  { icon: 'vente', label: 'Ventes' },
  { icon: 'graph', label: 'Dépenses' },
  { icon: 'stock', label: 'Stocks' },
  { icon: 'dette', label: 'Dettes' },
  { icon: 'rapport', label: 'Rapports' },
];

function ProgressDots({ step }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Étape ${step + 1} sur ${STEPS.length}`}>
      {STEPS.map((_, index) => (
        <span
          key={index}
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: index === step ? BRAND.orange : '#DDE2EA' }}
        />
      ))}
    </div>
  );
}

function ConversationPreview() {
  return (
    <div className="space-y-2.5">
      <div className="ml-8 rounded-2xl rounded-br-md bg-[#173873] px-3.5 py-3 text-white">
        <p className="text-[11px] font-semibold opacity-70">Toi</p>
        <p className="mt-0.5 text-[14px] leading-snug">J&apos;ai vendu 20 boîtes de craie à 1 500 FC.</p>
      </div>
      <div className="mr-8 rounded-2xl rounded-bl-md bg-white px-3.5 py-3 shadow-[0_1px_3px_rgba(23,32,51,0.04)]">
        <p className="text-[11px] font-semibold" style={{ color: BRAND.orange }}>Ashy</p>
        <p className="mt-1 text-[14px] font-semibold">Vente détectée ✓</p>
        <p className="mt-1 text-[13px] leading-relaxed" style={{ color: BRAND.textMuted }}>
          20 boîtes<br />
          1 500 FC / unité<br />
          Total : 30 000 FC
        </p>
      </div>
    </div>
  );
}

function OrganizePreview({ reduceMotion }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {ORGANIZE_ITEMS.map((item, index) => (
        <motion.div
          key={item.label}
          className="flex items-center gap-2.5 rounded-2xl bg-white px-3 py-3 shadow-[0_1px_3px_rgba(23,32,51,0.04)]"
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 * index, duration: 0.28 }}
        >
          <BrandIcon name={item.icon} size={32} />
          <p className="text-[14px] font-semibold">{item.label}</p>
        </motion.div>
      ))}
    </div>
  );
}

function SpacePreview() {
  return (
    <div className="rounded-[16px] bg-white p-3.5 shadow-[0_1px_3px_rgba(23,32,51,0.04)]">
      <p className="mb-3 text-[12px] font-semibold" style={{ color: BRAND.textMuted }}>Ton espace Ash Ledger</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SPACE_ITEMS.map((item) => (
          <div key={item.label} className="flex items-center gap-2 rounded-xl bg-[#F8FAFD] px-2.5 py-2.5">
            <BrandIcon name={item.icon} size={28} />
            <p className="text-[13px] font-semibold">{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function IntroGuidePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState(0);

  if (user?.id && isIntroGuideCompleted(user.id)) {
    return <Navigate to="/setup" replace />;
  }

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const goToSetup = (skipped) => {
    markIntroGuideCompleted(user?.id, skipped);
    navigate('/setup', { replace: true });
  };

  return (
    <>
      <Helmet>
        <title>Comment ça marche — Ash Ledger</title>
      </Helmet>
      <div className="min-h-[100dvh] overflow-x-clip" style={{ backgroundColor: '#F8FAFD', color: BRAND.text }}>
        <div className="mx-auto grid min-h-[100dvh] w-full max-w-6xl lg:grid-cols-2">
          <section className="flex min-h-[100dvh] flex-col px-5 pb-[max(20px,env(safe-area-inset-bottom,0px))] pt-[max(16px,env(safe-area-inset-top,0px))] sm:px-10">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2.5">
                <img src={LOGO_SYMBOL} alt="" width={36} height={36} className="h-9 w-9 object-contain" />
                <p className="text-[16px] font-bold tracking-tight" style={{ color: BRAND.navy }} translate="no">
                  Ash Ledger
                </p>
              </div>
              <ProgressDots step={step} />
            </div>

            <div className="my-1 lg:hidden">
              <AshyStage
                src={current.mascot}
                alt={current.mascotAlt}
                variant={current.mascotVariant}
                size="feature"
              />
            </div>

            <div className="mx-auto flex w-full max-w-md flex-1 flex-col lg:mx-0 lg:justify-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.22 }}
                >
                  <h1 className="text-[26px] font-bold leading-tight tracking-tight sm:text-[30px]">
                    {current.title}
                  </h1>
                  <p className="mt-2 text-[15px] leading-relaxed sm:text-[16px]" style={{ color: BRAND.textMuted }}>
                    {current.text}
                  </p>
                  <div className="mt-5">
                    {step === 0 ? <ConversationPreview /> : null}
                    {step === 1 ? <OrganizePreview reduceMotion={reduceMotion} /> : null}
                    {step === 2 ? <SpacePreview /> : null}
                  </div>
                </motion.div>
              </AnimatePresence>

              <div className="mt-auto pt-7">
                {isLast ? (
                  <>
                    <button
                      type="button"
                      onClick={() => goToSetup(false)}
                      className="flex h-[54px] w-full items-center justify-center rounded-2xl text-[16px] font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-[#FF7000]"
                      style={{ backgroundColor: BRAND.orange, boxShadow: '0 6px 16px rgba(255,112,0,0.22)' }}
                    >
                      Commencer la configuration
                    </button>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setStep((prev) => Math.max(0, prev - 1))}
                        className="flex min-h-11 items-center text-[14px] font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#FF7000]"
                        style={{ color: BRAND.navy }}
                      >
                        Retour
                      </button>
                      <button
                        type="button"
                        onClick={() => goToSetup(true)}
                        className="flex min-h-11 items-center text-[13px] font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#FF7000]"
                        style={{ color: BRAND.textFaint }}
                      >
                        Passer le guide
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setStep((prev) => Math.max(0, prev - 1))}
                        disabled={step === 0}
                        className="flex h-[54px] flex-1 items-center justify-center rounded-2xl border text-[16px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#FF7000] disabled:opacity-40"
                        style={{ borderColor: '#DDE2EA', color: BRAND.navy, backgroundColor: '#FFFFFF' }}
                      >
                        Retour
                      </button>
                      <button
                        type="button"
                        onClick={() => setStep((prev) => prev + 1)}
                        className="flex h-[54px] flex-[1.4] items-center justify-center rounded-2xl text-[16px] font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-[#FF7000]"
                        style={{ backgroundColor: BRAND.orange, boxShadow: '0 6px 16px rgba(255,112,0,0.22)' }}
                      >
                        Suivant
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => goToSetup(true)}
                      className="mt-3 flex min-h-11 w-full items-center justify-center text-[13px] font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#FF7000]"
                      style={{ color: BRAND.textFaint }}
                    >
                      Passer le guide
                    </button>
                  </>
                )}
              </div>
            </div>
          </section>

          <aside className="relative hidden overflow-x-clip px-6 lg:flex lg:items-center lg:justify-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={current.mascot}
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduceMotion ? undefined : { opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <AshyStage
                  src={current.mascot}
                  alt=""
                  variant={current.mascotVariant}
                  size="desktop"
                />
              </motion.div>
            </AnimatePresence>
          </aside>
        </div>
      </div>
    </>
  );
}
