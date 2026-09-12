import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Mic } from 'lucide-react';
import BrandIcon from '@/components/BrandIcon';
import { ASHY_WELCOME, BRAND, LOGO_SYMBOL } from '@/lib/brandAssets';

const BENEFITS = [
  { icon: 'chat', text: 'Parle naturellement, Ashy comprend' },
  { icon: 'graph', text: 'Ton activité est organisée automatiquement' },
  { icon: 'rapport', text: 'Analyse ton activité et obtiens des conseils' },
  { icon: 'shield', text: 'Tes données restent protégées' },
];

function FloatIcon({ className, children, delay = 0, reduceMotion }) {
  return (
    <motion.div
      className={`pointer-events-none select-none ${className}`}
      aria-hidden="true"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: [0, -4, 0] }}
      transition={
        reduceMotion
          ? { duration: 0.2 }
          : {
              opacity: { duration: 0.3, delay },
              y: { duration: 4.2, delay, repeat: Infinity, ease: 'easeInOut' },
            }
      }
    >
      {children}
    </motion.div>
  );
}

function WelcomeCta({ className = '' }) {
  return (
    <div className={className}>
      <Link
        to="/signup"
        className="flex h-[54px] w-full items-center justify-center rounded-2xl text-[16px] font-semibold text-white outline-none ring-offset-2 transition-transform focus-visible:ring-2 focus-visible:ring-[#FF7000] focus-visible:ring-offset-2 active:scale-[0.99] sm:max-w-md"
        style={{
          backgroundColor: BRAND.orange,
          boxShadow: '0 6px 16px rgba(255,112,0,0.22)',
        }}
      >
        Commencer gratuitement
      </Link>
      <p className="mt-2 text-center text-[13px] sm:max-w-md sm:text-left" style={{ color: BRAND.textFaint }}>
        30 jours d&apos;essai gratuit · Aucune carte bancaire requise
      </p>
      <p className="mt-1.5 text-center text-[14px] sm:max-w-md sm:text-left" style={{ color: BRAND.textMuted }}>
        Déjà utilisateur ?{' '}
        <Link
          to="/login"
          className="inline-flex min-h-11 items-center font-semibold outline-none hover:underline focus-visible:underline"
          style={{ color: BRAND.navy }}
        >
          Se connecter
        </Link>
      </p>
    </div>
  );
}

export default function WelcomePage() {
  const reduceMotion = useReducedMotion();
  const fadeUp = (delay = 0) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.32, delay, ease: [0.22, 1, 0.36, 1] },
        };

  return (
    <>
      <Helmet>
        <title>Ash Ledger — Ton assistant financier intelligent</title>
        <meta
          name="description"
          content="Enregistre tes ventes, dépenses, stock et dettes simplement en parlant à Ashy."
        />
      </Helmet>

      <div
        className="relative min-h-[100dvh] overflow-x-clip"
        style={{ backgroundColor: BRAND.bg, color: BRAND.text }}
      >
        <div
          className="pointer-events-none absolute -left-24 top-10 h-64 w-64 rounded-full opacity-70"
          style={{ background: 'radial-gradient(circle, #FF700028 0%, transparent 68%)' }}
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -right-20 top-36 h-56 w-56 rounded-full opacity-80"
          style={{ background: 'radial-gradient(circle, #2563EB22 0%, transparent 70%)' }}
          aria-hidden="true"
        />

        <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 pb-1 pt-[max(14px,env(safe-area-inset-top))] sm:px-8">
          <div className="flex items-center gap-2.5">
            <img
              src={LOGO_SYMBOL}
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 object-contain"
            />
            <p className="text-[16px] font-bold leading-none tracking-tight" style={{ color: BRAND.navy }} translate="no">
              Ash Ledger
            </p>
          </div>
          <Link
            to="/login"
            className="inline-flex min-h-11 min-w-11 items-center rounded-xl px-3 text-[14px] font-semibold outline-none ring-offset-2 transition-colors hover:bg-white focus-visible:ring-2"
            style={{ color: BRAND.navy }}
          >
            Se connecter
          </Link>
        </header>

        <main className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-4 px-5 pb-[calc(14.5rem+env(safe-area-inset-bottom,0px))] pt-3 sm:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-10 lg:pb-10 lg:pt-8">
          <section className="flex min-w-0 flex-col">
            <motion.h1
              className="max-w-[16ch] text-[28px] font-bold leading-[1.15] tracking-tight sm:text-[34px] lg:text-[48px]"
              {...fadeUp(0.04)}
            >
              Parle à{' '}
              <span style={{ color: BRAND.orange }}>Ashy</span>
              ,<br />
              il s&apos;occupe du reste&nbsp;!
            </motion.h1>
            <motion.p
              className="mt-2.5 max-w-md text-[15px] leading-relaxed sm:text-[18px]"
              style={{ color: BRAND.textMuted }}
              {...fadeUp(0.1)}
            >
              Enregistre tes ventes, dépenses, stock et dettes simplement en lui parlant.
            </motion.p>

            <div className="relative mx-auto mt-1 w-full max-w-[min(100%,420px)] lg:hidden">
              <AshyHero reduceMotion={reduceMotion} size="mobile" />
            </div>

            <motion.ul className="mt-3 grid gap-1.5 sm:mt-6 sm:gap-2.5" {...fadeUp(0.14)}>
              {BENEFITS.map(({ icon, text }) => (
                <li
                  key={text}
                  className="flex items-center gap-2.5 rounded-[14px] bg-white px-3 py-1.5 shadow-[0_1px_3px_rgba(23,32,51,0.04)] sm:px-3.5 sm:py-2.5"
                >
                  <BrandIcon name={icon} size={28} />
                  <span className="text-[13px] font-medium leading-snug sm:text-[15px]">{text}</span>
                </li>
              ))}
            </motion.ul>

            <WelcomeCta className="mt-8 hidden lg:block" />
          </section>

          <section className="relative hidden min-h-[520px] items-center justify-center lg:flex">
            <AshyHero reduceMotion={reduceMotion} size="desktop" />
          </section>
        </main>

        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t border-black/[0.04] px-5 pt-3 lg:hidden"
          style={{
            backgroundColor: 'rgba(248,249,251,0.96)',
            paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
          }}
        >
          <WelcomeCta />
        </div>
      </div>
    </>
  );
}

function AshyHero({ reduceMotion, size }) {
  const isDesktop = size === 'desktop';

  return (
    <div className={`relative mx-auto ${isDesktop ? 'w-full max-w-[min(100%,560px)]' : 'w-full'}`}>
      <div className="relative mx-auto w-fit max-w-full">
        <FloatIcon
          reduceMotion={reduceMotion}
          delay={0.12}
          className="absolute left-[4%] top-[18%] z-10"
        >
          <BrandIcon name="vente" size={isDesktop ? 22 : 16} />
        </FloatIcon>
        <FloatIcon
          reduceMotion={reduceMotion}
          delay={0.2}
          className="absolute right-[6%] top-[22%] z-10"
        >
          <BrandIcon name="stock" size={isDesktop ? 22 : 16} />
        </FloatIcon>
        <FloatIcon
          reduceMotion={reduceMotion}
          delay={0.28}
          className="absolute bottom-[12%] left-[8%] z-10"
        >
          <BrandIcon name="graph" size={isDesktop ? 22 : 16} />
        </FloatIcon>

        <motion.img
          src={ASHY_WELCOME}
          alt="Ashy, l'assistant financier d'Ash Ledger"
          fetchPriority="high"
          className={`relative z-[1] mx-auto block bg-transparent object-contain object-bottom ${
            isDesktop
              ? 'h-[min(68vh,640px)] w-auto max-w-full'
              : 'h-[min(50vh,420px)] w-auto max-w-[min(100%,340px)]'
          }`}
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          draggable={false}
        />
      </div>

      {isDesktop && (
        <>
          <motion.div
            className="absolute bottom-[6%] left-0 z-20 w-[230px] rounded-[20px] bg-white px-3.5 py-3 shadow-[0_6px_20px_rgba(23,32,51,0.08)]"
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, delay: 0.2 }}
          >
            <div className="flex items-start gap-2">
              <span
                className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: '#FFF1E6' }}
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
                  <path d="M4 15h11l3 4V6a2 2 0 00-2-2H4a2 2 0 00-2 2v7a2 2 0 002 2z" stroke="#FF7000" strokeWidth="1.8" />
                </svg>
              </span>
              <p className="flex-1 text-[13px] leading-snug" style={{ color: BRAND.text }}>
                J&apos;ai dépensé 45.000 FC pour le transport.
              </p>
              <Mic size={16} color={BRAND.blue} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            </div>
            <div className="mt-2.5 flex items-start gap-2 border-t border-black/[0.04] pt-2.5">
              <span
                className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                style={{ backgroundColor: BRAND.success }}
                aria-hidden="true"
              >
                ✓
              </span>
              <p className="text-[12px] leading-snug" style={{ color: BRAND.text }}>
                <span className="font-semibold">Dépense enregistrée.</span>
                <br />
                Transport 45.000 FC
              </p>
            </div>
          </motion.div>

          <motion.div
            className="absolute right-0 top-[8%] z-20 w-[220px] rounded-[20px] px-4 py-3 shadow-[0_6px_20px_rgba(124,58,237,0.12)]"
            style={{ backgroundColor: '#F6F1FF' }}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, delay: 0.28 }}
          >
            <p className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: '#6D28D9' }}>
              <span
                className="inline-flex h-6 w-6 items-center justify-center rounded-full"
                style={{ backgroundColor: '#7C3AED' }}
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none">
                  <path d="M9 18h6M10 21h4M12 3a6 6 0 00-3 11c.5 1 1 2 1 3h4c0-1 .5-2 1-3a6 6 0 00-3-11z" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
              Insight d&apos;Ashy ✦
            </p>
            <p className="mt-1.5 text-[13px] leading-snug" style={{ color: BRAND.textMuted }}>
              Tes dépenses de transport ont augmenté de 18% cette semaine.
            </p>
          </motion.div>
        </>
      )}
    </div>
  );
}
