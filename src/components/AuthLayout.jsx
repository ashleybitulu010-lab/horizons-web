import { Eye, EyeOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BRAND, LOGO_SYMBOL } from '@/lib/brandAssets';
import AshyStage from '@/components/AshyStage';

export function splitFullName(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

export function isStrongPassword(value) {
  return String(value || '').length >= 8;
}

export function friendlyAuthError(err, fallback) {
  const raw = String(err?.message || err || '');
  const lower = raw.toLowerCase();
  if (
    lower.includes('failed to fetch')
    || lower.includes('network')
    || lower.includes('load failed')
    || err?.status === 0
  ) {
    return 'Impossible de contacter le serveur. Vérifie ta connexion puis réessaie.';
  }
  if (lower.includes('not unique') || lower.includes('already') || lower.includes('déjà')) {
    return 'Cette adresse e-mail est déjà associée à un compte. Essaie de te connecter.';
  }
  if (lower.includes('incorrect') || err?.status === 400) {
    return fallback;
  }
  if (raw && !/pocketbase|supabase|status|stack|validation_/i.test(raw)) {
    return raw;
  }
  return fallback;
}

const inputBase =
  'w-full rounded-2xl border bg-white px-4 py-[14px] text-[15px] outline-none transition-colors placeholder:text-[#9AA3B2]';

export function Field({
  id,
  label,
  error,
  aside,
  children,
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label htmlFor={id} className="block text-[13px] font-semibold" style={{ color: BRAND.text }}>
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[13px]" style={{ color: BRAND.error }} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({ id, error, className = '', ...props }) {
  return (
    <input
      id={id}
      aria-invalid={Boolean(error)}
      aria-describedby={error ? `${id}-error` : undefined}
      className={`${inputBase} ${error ? 'border-red-300' : 'border-[#DDE2EA]'} focus:border-[#FF7000] focus:ring-2 focus:ring-[#FF7000]/15 ${className}`}
      {...props}
    />
  );
}

export function PasswordInput({
  id,
  value,
  onChange,
  error,
  placeholder,
  autoComplete,
  visible,
  onToggle,
  toggleLabelShow = 'Afficher le mot de passe',
  toggleLabelHide = 'Masquer le mot de passe',
}) {
  return (
    <div className="relative">
      <TextInput
        id={id}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        error={error}
        className="pr-12"
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-1 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-xl text-[#9AA3B2] outline-none hover:text-[#172033] focus-visible:ring-2 focus-visible:ring-[#FF7000]"
        aria-label={visible ? toggleLabelHide : toggleLabelShow}
        aria-pressed={visible}
      >
        {visible ? <EyeOff size={18} strokeWidth={1.8} /> : <Eye size={18} strokeWidth={1.8} />}
      </button>
    </div>
  );
}

export function AuthSubmit({ loading, children, loadingLabel }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="mt-2 flex h-[54px] w-full items-center justify-center rounded-2xl text-[16px] font-semibold text-white outline-none ring-offset-2 transition-transform focus-visible:ring-2 focus-visible:ring-[#FF7000] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
      style={{ backgroundColor: BRAND.orange, boxShadow: '0 6px 16px rgba(255,112,0,0.22)' }}
    >
      {loading ? loadingLabel : children}
    </button>
  );
}

export default function AuthLayout({ children, intro, mascotSrc, mascotAlt = '', mascotVariant = 'welcome' }) {
  return (
    <div className="min-h-[100dvh] overflow-x-clip" style={{ backgroundColor: BRAND.bg, color: BRAND.text }}>
      <div className="mx-auto grid min-h-[100dvh] w-full max-w-6xl lg:grid-cols-2">
        <section className="flex flex-col px-5 pb-8 pt-[max(16px,env(safe-area-inset-top,0px))] sm:px-10 lg:justify-center">
          <Link to="/" className="mb-5 inline-flex w-fit items-center gap-2.5 outline-none focus-visible:ring-2 focus-visible:ring-[#FF7000] lg:mb-8">
            <img src={LOGO_SYMBOL} alt="" width={36} height={36} className="h-9 w-9 object-contain" />
            <span className="text-[16px] font-bold tracking-tight" style={{ color: BRAND.navy }} translate="no">
              Ash Ledger
            </span>
          </Link>

          {intro}

          {mascotSrc ? (
            <div className="my-2 lg:hidden">
              <AshyStage src={mascotSrc} alt={mascotAlt} variant={mascotVariant} size="mobile" />
            </div>
          ) : null}

          <div className="w-full max-w-md">{children}</div>
        </section>

        {mascotSrc ? (
          <aside className="relative hidden overflow-x-clip px-6 lg:flex lg:items-center lg:justify-center">
            <AshyStage src={mascotSrc} alt="" variant={mascotVariant} size="desktop" />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
