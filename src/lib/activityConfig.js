import { createDashboardSession, supabase } from '@/lib/supabaseRest';

/** Canonical activity-type ids stored in clients.type_activite. */
export const ACTIVITY_TYPE = Object.freeze({
  COMMERCE: 'commerce',
  SERVICE: 'service',
  PRODUCTION: 'production',
  AUTRE: 'autre',
});

export const ACTIVITY_TYPES = [
  {
    id: ACTIVITY_TYPE.COMMERCE,
    label: 'Commerce',
    description: 'Tu achètes et revends des produits.',
    available: true,
  },
  { id: ACTIVITY_TYPE.SERVICE, label: 'Service', available: false },
  { id: ACTIVITY_TYPE.PRODUCTION, label: 'Production', available: false },
  { id: ACTIVITY_TYPE.AUTRE, label: 'Autre', available: false },
];

export const AVAILABLE_ACTIVITY_TYPES = ACTIVITY_TYPES.filter((type) => type.available);

export const CURRENCY_OPTIONS = [
  { id: 'CDF', label: 'FC' },
  { id: 'USD', label: 'USD' },
];

const DRAFT_KEY = 'ash_setup_draft_v1';

const SELECT_FIELDS = [
  'id',
  'nom_activite',
  'type_activite',
  'currency_preference',
  'gestion_stock',
  'suivi_dettes',
  'configuration_completed',
].join(',');

export function emptyActivityForm() {
  return {
    nomActivite: '',
    typeActivite: '',
    currency: 'USD',
    gestionStock: null,
    suiviDettes: null,
  };
}

export function activityTypeLabel(id) {
  return ACTIVITY_TYPES.find((t) => t.id === id)?.label || id || '—';
}

export function currencyLabel(id) {
  return CURRENCY_OPTIONS.find((c) => c.id === id)?.label || id || '—';
}

export function yesNoLabel(value) {
  if (value === true) return 'Oui';
  if (value === false) return 'Non';
  return '—';
}

function rowToForm(row = {}) {
  return {
    nomActivite: String(row.nom_activite || '').trim(),
    typeActivite: row.type_activite || '',
    currency: row.currency_preference === 'CDF' ? 'CDF' : 'USD',
    gestionStock: typeof row.gestion_stock === 'boolean' ? row.gestion_stock : null,
    suiviDettes: typeof row.suivi_dettes === 'boolean' ? row.suivi_dettes : null,
  };
}

function formToPayload(form) {
  return {
    nom_activite: form.nomActivite.trim(),
    type_activite: form.typeActivite,
    currency_preference: form.currency,
    ledger_currency: form.currency,
    gestion_stock: Boolean(form.gestionStock),
    suivi_dettes: Boolean(form.suiviDettes),
    configuration_completed: true,
    onboarding_status: 'pending',
    onboarding_step: 0,
  };
}

export function validateStep1(form) {
  const errors = {};
  if (!form.nomActivite.trim()) {
    errors.nomActivite = 'Entre le nom de ton activité.';
  }
  if (!AVAILABLE_ACTIVITY_TYPES.some((type) => type.id === form.typeActivite)) {
    errors.typeActivite = 'Choisis un type d\'activité.';
  }
  if (!form.currency) {
    errors.currency = 'Choisis ta devise principale.';
  }
  if (form.gestionStock === null) {
    errors.gestionStock = 'Indique si tu gères du stock.';
  }
  if (form.suiviDettes === null) {
    errors.suiviDettes = 'Indique si tu suis les dettes ou crédits clients.';
  }
  return errors;
}

export function readSetupDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeSetupDraft(form, step = 1) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ form, step, savedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function clearSetupDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export async function loadActivityConfig(pocketBaseToken) {
  if (!supabase) throw new Error('Supabase is not configured');
  const clientId = await createDashboardSession(pocketBaseToken);
  const { data, error } = await supabase
    .from('clients')
    .select(SELECT_FIELDS)
    .eq('id', clientId)
    .single();
  if (error) throw error;

  return {
    clientId,
    configurationCompleted: Boolean(data.configuration_completed),
    form: rowToForm(data),
  };
}

export async function saveActivityConfig(pocketBaseToken, form) {
  if (!supabase) throw new Error('Supabase is not configured');
  const errors = validateStep1(form);
  if (Object.keys(errors).length) {
    throw new Error('Les informations de ton activité ne sont pas complètes.');
  }

  const clientId = await createDashboardSession(pocketBaseToken);
  const payload = formToPayload(form);
  const { data, error } = await supabase
    .from('clients')
    .update(payload)
    .eq('id', clientId)
    .select(SELECT_FIELDS)
    .single();
  if (error) throw error;

  clearSetupDraft();
  return {
    clientId,
    configurationCompleted: Boolean(data.configuration_completed),
    form: rowToForm(data),
  };
}
