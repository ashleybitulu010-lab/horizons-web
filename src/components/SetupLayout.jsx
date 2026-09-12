import AshyStage from '@/components/AshyStage';
import { BRAND, LOGO_SYMBOL } from '@/lib/brandAssets';

function ProgressDots({ step }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <p className="text-[13px] font-semibold" style={{ color: BRAND.textMuted }}>
        {step} sur 2
      </p>
      <div className="flex items-center gap-2" aria-hidden="true">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: step === 1 ? BRAND.orange : '#DDE2EA' }}
        />
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: step === 2 ? BRAND.orange : '#DDE2EA' }}
        />
      </div>
    </div>
  );
}

export default function SetupLayout({
  step,
  title,
  subtitle,
  mascotSrc,
  mascotAlt = '',
  mascotVariant = 'start',
  children,
}) {
  return (
    <div className="min-h-[100dvh] overflow-x-clip" style={{ backgroundColor: '#F8FAFD', color: BRAND.text }}>
      <div className={`mx-auto grid min-h-[100dvh] w-full max-w-6xl ${mascotSrc ? 'lg:grid-cols-2' : ''}`}>
        <section className="flex flex-col px-5 pb-[max(28px,env(safe-area-inset-bottom,0px))] pt-[max(16px,env(safe-area-inset-top,0px))] sm:px-10 lg:justify-center">
          <div className="mb-4 inline-flex items-center gap-2.5 lg:mb-6">
            <img src={LOGO_SYMBOL} alt="" width={36} height={36} className="h-9 w-9 object-contain" />
            <p className="text-[16px] font-bold tracking-tight" style={{ color: BRAND.navy }} translate="no">
              Ash Ledger
            </p>
          </div>

          <ProgressDots step={step} />

          <div className="w-full max-w-md">
            <h1 className="text-[26px] font-bold leading-tight tracking-tight sm:text-[30px]">{title}</h1>
            {subtitle ? (
              <p className="mt-2 text-[15px] leading-relaxed sm:text-[16px]" style={{ color: BRAND.textMuted }}>
                {subtitle}
              </p>
            ) : null}
          </div>

          {mascotSrc ? (
            <div className="my-3 lg:hidden">
              <AshyStage src={mascotSrc} alt={mascotAlt} variant={mascotVariant} size="feature" />
            </div>
          ) : null}

          <div className={`w-full max-w-md ${mascotSrc ? 'mt-2' : 'mt-6'}`}>{children}</div>
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

export function SetupField({ label, error, children }) {
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-semibold">{label}</p>
      {children}
      {error ? (
        <p className="text-[13px]" style={{ color: BRAND.error }} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SetupTextInput({ value, onChange, placeholder, error, id }) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-invalid={Boolean(error)}
      className={`w-full rounded-2xl border bg-white px-4 py-[14px] text-[15px] outline-none transition-colors placeholder:text-[#9AA3B2] focus:border-[#FF7000] focus:ring-2 focus:ring-[#FF7000]/15 ${
        error ? 'border-red-300' : 'border-[#DDE2EA]'
      }`}
    />
  );
}

export function ChoiceCards({ options, value, onChange, columns = 2 }) {
  return (
    <div className={`grid gap-2.5 ${columns === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'}`}>
      {options.map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className="min-h-[52px] rounded-2xl border px-3 py-3 text-[15px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#FF7000] focus-visible:ring-offset-2"
            style={{
              borderColor: selected ? BRAND.orange : '#DDE2EA',
              backgroundColor: selected ? '#FFF4EB' : '#FFFFFF',
              color: selected ? BRAND.navy : BRAND.text,
              boxShadow: selected ? '0 0 0 1px rgba(255,112,0,0.18)' : 'none',
            }}
            aria-pressed={selected}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function YesNoCards({ value, onChange }) {
  return (
    <ChoiceCards
      options={[
        { id: true, label: 'Oui' },
        { id: false, label: 'Non' },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}

export function SetupSubmit({ children, loading, disabled, onClick, type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className="mt-7 flex h-[54px] w-full items-center justify-center rounded-2xl text-[16px] font-semibold text-white outline-none ring-offset-2 transition-transform focus-visible:ring-2 focus-visible:ring-[#FF7000] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
      style={{ backgroundColor: BRAND.orange, boxShadow: '0 6px 16px rgba(255,112,0,0.22)' }}
    >
      {loading ? 'Enregistrement...' : children}
    </button>
  );
}

export function ReviewRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#EEF2F7] py-3 last:border-b-0">
      <p className="text-[13px]" style={{ color: BRAND.textMuted }}>{label}</p>
      <p className="max-w-[58%] text-right text-[15px] font-semibold">{value}</p>
    </div>
  );
}
