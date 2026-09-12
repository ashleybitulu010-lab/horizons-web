const PALE = '#E9F1FB';
const NAVY = '#173B73';
const ORANGE = '#FF7000';

function WelcomeDecor() {
  return (
    <svg viewBox="0 0 420 520" className="absolute inset-0 h-full w-full" aria-hidden="true">
      <circle cx="210" cy="248" r="168" fill={PALE} />
      <circle cx="86" cy="92" r="18" fill={PALE} />
      <circle cx="338" cy="118" r="8" fill={ORANGE} opacity="0.55" />
      <rect x="332" y="372" width="22" height="22" rx="5" fill={PALE} transform="rotate(18 343 383)" />
      <path d="M78 368c28-8 46 14 72 10" fill="none" stroke={NAVY} strokeOpacity="0.12" strokeWidth="1.4" />
      <path d="M92 392c22-18 48-8 70-22 18-12 34-6 48-16" fill="none" stroke={NAVY} strokeOpacity="0.1" strokeWidth="1.2" />
      <path d="M300 86 L308 86 L308 102 L318 102 L318 78 L328 78 L328 112" fill="none" stroke={NAVY} strokeOpacity="0.16" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M204 64 L208 74 L218 74 L210 80 L213 90 L204 84 L195 90 L198 80 L190 74 L200 74 Z" fill={ORANGE} opacity="0.7" />
    </svg>
  );
}

function StartDecor() {
  return (
    <svg viewBox="0 0 420 520" className="absolute inset-0 h-full w-full" aria-hidden="true">
      <ellipse cx="214" cy="250" rx="176" ry="162" fill={PALE} />
      <circle cx="348" cy="96" r="16" fill={PALE} />
      <circle cx="74" cy="132" r="7" fill={ORANGE} opacity="0.5" />
      <rect x="62" y="386" width="28" height="10" rx="5" fill={PALE} />
      <path d="M70 360 L86 332 L104 344 L126 308 L148 322 L176 286" fill="none" stroke={NAVY} strokeOpacity="0.14" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M300 392 L312 360 L328 372 L344 328 L360 340" fill="none" stroke={NAVY} strokeOpacity="0.1" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M318 72 L322 82 L332 82 L324 88 L327 98 L318 92 L309 98 L312 88 L304 82 L314 82 Z" fill={ORANGE} opacity="0.65" />
    </svg>
  );
}

export default function AshyStage({
  src,
  alt = '',
  variant = 'welcome',
  size = 'desktop',
}) {
  const isMobile = size === 'mobile';
  const isFeature = size === 'feature';
  const frame = isMobile
    ? 'h-[min(22vh,176px)] w-full max-w-[200px]'
    : isFeature
      ? 'h-[min(34vh,248px)] w-full max-w-[260px]'
      : 'h-[min(72vh,560px)] w-full max-w-[460px]';
  const image = isMobile
    ? 'h-[min(22vh,176px)] max-w-[86%]'
    : isFeature
      ? 'h-[min(32vh,236px)] max-w-[88%]'
      : 'h-[min(68vh,520px)] max-w-[78%]';

  return (
    <div className={`relative mx-auto flex items-end justify-center overflow-hidden ${frame}`}>
      <div className={`pointer-events-none absolute ${isMobile || isFeature ? 'inset-[-6%]' : 'inset-[4%_2%_0]'}`} aria-hidden="true">
        {variant === 'start' ? <StartDecor /> : <WelcomeDecor />}
      </div>
      <img
        src={src}
        alt={alt}
        className={`relative z-[1] w-auto object-contain object-bottom ${image}`}
        draggable={false}
      />
    </div>
  );
}
