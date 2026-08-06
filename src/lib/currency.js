import { createDashboardSession, supabase } from '@/lib/supabaseRest';

export const DEFAULT_USD_CDF_RATE = 2295;

export const DEFAULT_CURRENCY_SETTINGS = Object.freeze({
  displayCurrency: 'USD',
  ledgerCurrency: 'USD',
  usdCdfRate: DEFAULT_USD_CDF_RATE,
});

function validCurrency(value, fallback = 'USD') {
  return value === 'CDF' || value === 'USD' ? value : fallback;
}

function validRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_USD_CDF_RATE;
}

export function normalizeCurrencySettings(row = {}) {
  return {
    displayCurrency: validCurrency(
      row.displayCurrency || row.currency_preference,
      'USD',
    ),
    ledgerCurrency: validCurrency(
      row.ledgerCurrency || row.ledger_currency,
      'USD',
    ),
    usdCdfRate: validRate(row.usdCdfRate || row.usd_cdf_rate),
  };
}

export function convertCurrency(amount, settings = DEFAULT_CURRENCY_SETTINGS) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;

  const {
    displayCurrency,
    ledgerCurrency,
    usdCdfRate,
  } = normalizeCurrencySettings(settings);

  if (displayCurrency === ledgerCurrency) return value;
  if (ledgerCurrency === 'CDF' && displayCurrency === 'USD') {
    return value / usdCdfRate;
  }
  if (ledgerCurrency === 'USD' && displayCurrency === 'CDF') {
    return value * usdCdfRate;
  }
  return value;
}

export function formatCurrency(amount, currency = 'USD') {
  const normalizedCurrency = validCurrency(currency);
  const locale = normalizedCurrency === 'USD' ? 'en-US' : 'fr-CD';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: normalizedCurrency,
    minimumFractionDigits: normalizedCurrency === 'USD' ? 2 : 0,
    maximumFractionDigits: normalizedCurrency === 'USD' ? 2 : 0,
  }).format(Number(amount) || 0);
}

export function formatCompactCurrency(amount, currency = 'USD') {
  const normalizedCurrency = validCurrency(currency);
  const locale = normalizedCurrency === 'USD' ? 'en-US' : 'fr-CD';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: normalizedCurrency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(amount) || 0);
}

function storageKey(userId) {
  return userId ? `ash_currency_${userId}` : null;
}

export function readStoredCurrencyPreference(userId) {
  const key = storageKey(userId);
  if (!key || typeof localStorage === 'undefined') return DEFAULT_CURRENCY_SETTINGS;
  try {
    const stored = JSON.parse(localStorage.getItem(key) || 'null');
    return stored ? normalizeCurrencySettings(stored) : DEFAULT_CURRENCY_SETTINGS;
  } catch {
    return DEFAULT_CURRENCY_SETTINGS;
  }
}

export function storeCurrencyPreference(userId, settings) {
  const key = storageKey(userId);
  const normalized = normalizeCurrencySettings(settings);
  if (key && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(key, JSON.stringify(normalized));
    } catch {
      // Supabase remains the source of truth when local storage is unavailable.
    }
  }
  return normalized;
}

export async function loadCurrencyPreference(pocketBaseToken, userId) {
  if (!supabase) throw new Error('Supabase is not configured');
  const clientId = await createDashboardSession(pocketBaseToken);
  const { data, error } = await supabase
    .from('clients')
    .select('currency_preference,ledger_currency,usd_cdf_rate')
    .eq('id', clientId)
    .single();
  if (error) throw error;

  return {
    clientId,
    ...storeCurrencyPreference(userId, data),
  };
}

export async function saveCurrencyPreference({
  clientId,
  userId,
  displayCurrency,
  usdCdfRate,
}) {
  if (!supabase || !clientId) throw new Error('Supabase client is unavailable');
  const payload = {
    currency_preference: validCurrency(displayCurrency),
    usd_cdf_rate: validRate(usdCdfRate),
  };
  const { data, error } = await supabase
    .from('clients')
    .update(payload)
    .eq('id', clientId)
    .select('currency_preference,ledger_currency,usd_cdf_rate')
    .single();
  if (error) throw error;
  return storeCurrencyPreference(userId, data);
}
