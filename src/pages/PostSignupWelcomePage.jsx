import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import BrandIcon from '@/components/BrandIcon';
import AshyStage from '@/components/AshyStage';
import { ASHY_GREETING, BRAND, LOGO_SYMBOL } from '@/lib/brandAssets';

const STEPS = [
  {
    icon: 'chat',
    title: 'Tu me parles',
    text: 'Écris-moi tes ventes, dépenses, stocks ou dettes naturellement.',
  },
  {
    icon: 'graph',
    title: 'Je les organise',
    text: 'Ashy transforme tes messages en informations structurées.',
  },
  {
    icon: 'shield',
    title: 'Tu gardes le contrôle',
    text: 'Retrouve ton activité organisée dans ton espace Ash Ledger.',
  },
];

export default function PostSignupWelcomePage() {
  return (
    <>
      <Helmet>
        <title>Bienvenue — Ash Ledger</title>
      </Helmet>
      <div className="min-h-[100dvh] overflow-x-clip" style={{ backgroundColor: '#F8FAFD', color: BRAND.text }}>
        <div className="mx-auto grid min-h-[100dvh] w-full max-w-6xl lg:grid-cols-2">
          <section className="flex flex-col px-5 pb-[max(28px,env(safe-area-inset-bottom,0px))] pt-[max(16px,env(safe-area-inset-top,0px))] sm:px-10 lg:justify-center">
            <div className="mb-6 inline-flex items-center gap-2.5 lg:mb-8">
              <img src={LOGO_SYMBOL} alt="" width={36} height={36} className="h-9 w-9 object-contain" />
              <p className="text-[16px] font-bold tracking-tight" style={{ color: BRAND.navy }} translate="no">
                Ash Ledger
              </p>
            </div>

            <div className="w-full max-w-md">
              <h1 className="text-[28px] font-bold leading-[1.15] tracking-tight sm:text-[34px] lg:text-[40px]">
                Bienvenue dans Ash Ledger 👋
              </h1>
              <p className="mt-3 text-[16px] leading-relaxed sm:text-[18px]" style={{ color: BRAND.textMuted }}>
                Je suis <span className="font-semibold" style={{ color: BRAND.orange }}>Ashy</span>. Je vais t&apos;aider à organiser ton activité simplement.
              </p>
            </div>

            <div className="my-4 lg:hidden">
              <AshyStage
                src={ASHY_GREETING}
                alt="Ashy, l'assistant financier d'Ash Ledger, te souhaite la bienvenue"
                variant="welcome"
                size="feature"
              />
            </div>

            <ul className="mt-2 grid w-full max-w-md gap-3 sm:mt-6">
              {STEPS.map((step) => (
                <li
                  key={step.title}
                  className="flex items-start gap-3 rounded-[16px] bg-white px-3.5 py-3 shadow-[0_1px_3px_rgba(23,32,51,0.04)]"
                >
                  <BrandIcon name={step.icon} size={36} />
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold leading-snug">{step.title}</p>
                    <p className="mt-0.5 text-[13px] leading-snug" style={{ color: BRAND.textMuted }}>
                      {step.text}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <Link
              to="/guide"
              className="mt-7 flex h-[54px] w-full max-w-md items-center justify-center rounded-2xl text-[16px] font-semibold text-white outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-[#FF7000]"
              style={{ backgroundColor: BRAND.orange, boxShadow: '0 6px 16px rgba(255,112,0,0.22)' }}
            >
              Commencer la configuration
            </Link>
            <p className="mt-2.5 text-[13px]" style={{ color: BRAND.textFaint }}>
              Cela prend seulement quelques minutes.
            </p>
          </section>

          <aside className="relative hidden overflow-x-clip px-6 lg:flex lg:items-center lg:justify-center">
            <AshyStage
              src={ASHY_GREETING}
              alt=""
              variant="welcome"
              size="desktop"
            />
          </aside>
        </div>
      </div>
    </>
  );
}
