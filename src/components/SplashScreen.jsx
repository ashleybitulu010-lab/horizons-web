import { motion, useReducedMotion } from 'framer-motion';
import { BRAND, LOGO_SYMBOL, LOGO_SYMBOL_WHITE } from '@/lib/brandAssets';

const TAGLINE = 'Ton assistant financier intelligent';

/** phase: splash | transition | reveal | exit */
export default function SplashScreen({ phase = 'splash' }) {
  const reduceMotion = useReducedMotion();
  const isOrange = phase === 'splash';
  const showColorLogo = phase === 'transition' || phase === 'reveal' || phase === 'exit';
  const isExiting = phase === 'exit';

  const logoSize = 'clamp(88px, 22vw, 128px)';
  const bgColor = isOrange ? BRAND.orange : BRAND.bg;

  const textFade = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: isExiting ? 0 : 1, y: isExiting ? -4 : 0 },
        transition: { duration: isExiting ? 0.35 : 0.32, ease: [0.22, 1, 0.36, 1] },
      };

  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-busy={!isExiting}
      aria-label="Ouverture d'Ash Ledger"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden px-6"
      initial={false}
      animate={{ opacity: isExiting ? 0 : 1 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.35, ease: 'easeOut' }}
      style={{
        backgroundColor: bgColor,
        transition: reduceMotion ? 'none' : 'background-color 500ms ease',
        paddingTop: 'max(16px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
      }}
    >
      <img src={LOGO_SYMBOL_WHITE} alt="" aria-hidden="true" className="hidden" fetchPriority="high" />
      <img src={LOGO_SYMBOL} alt="" aria-hidden="true" className="hidden" />

      <div className="relative flex flex-col items-center" style={{ width: logoSize, minHeight: logoSize }}>
        <motion.img
          key={showColorLogo ? 'color' : 'white'}
          src={showColorLogo ? LOGO_SYMBOL : LOGO_SYMBOL_WHITE}
          alt=""
          aria-hidden="true"
          className="object-contain"
          style={{ width: logoSize, height: logoSize }}
          initial={reduceMotion ? false : { opacity: 0, y: 8, scale: showColorLogo ? 0.98 : 1 }}
          animate={{ opacity: isExiting ? 0 : 1, y: isExiting ? -6 : 0, scale: 1 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: showColorLogo ? 0.36 : 0.28, ease: [0.22, 1, 0.36, 1] }
          }
        />
      </div>

      <motion.p
        className="mt-5 text-center text-[clamp(20px,5vw,24px)] font-semibold tracking-tight"
        translate="no"
        style={{
          color: isOrange ? BRAND.white : BRAND.navy,
          transition: reduceMotion ? 'none' : 'color 500ms ease',
        }}
        {...textFade}
      >
        Ash Ledger
      </motion.p>

      <motion.p
        className="mt-1.5 max-w-xs text-center text-[clamp(13px,3.4vw,15px)] font-normal leading-snug"
        style={{
          color: isOrange ? 'rgba(255,255,255,0.92)' : BRAND.textMuted,
          transition: reduceMotion ? 'none' : 'color 500ms ease',
        }}
        {...textFade}
        transition={
          reduceMotion
            ? undefined
            : { duration: isExiting ? 0.35 : 0.32, delay: isExiting ? 0 : 0.05, ease: [0.22, 1, 0.36, 1] }
        }
      >
        {TAGLINE}
      </motion.p>

      <span className="sr-only">
        {isExiting ? 'Ash Ledger — ouverture terminée' : 'Ash Ledger — démarrage'}
      </span>
    </motion.div>
  );
}
