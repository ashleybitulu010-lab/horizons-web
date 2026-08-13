import { needsHumanEscalation } from '@/lib/onboardingChecks';
import { createDashboardSession, supabase } from '@/lib/supabaseRest';
import pb from '@/lib/pocketbaseClient';

const SUPPORT_BRIDGE_URL = import.meta.env.VITE_SUPPORT_BRIDGE_URL
  || 'https://ashledger.tech/hcgi/support-bridge/';
const TELEGRAM_WEBHOOK = import.meta.env.VITE_TELEGRAM_SUPPORT_WEBHOOK || '';

const FAQ = [
  {
    test: /comment\s+(ajouter|enregistrer|faire)\s+(une\s+)?vente/i,
    reply: `Pour ajouter une vente, parlez à Ashy dans le chat principal, comme vous parleriez :

• « J'ai vendu 10 boîtes de craies scolaires »
• « Vente de 5 boîtes »

Ashy comprend le langage naturel — aucune syntaxe spéciale.

Rappel : produit → stock → vente.`,
  },
  {
    test: /comment\s+(ajouter|cr[ée]{1,2}r|enregistrer)\s+(un\s+)?produit/i,
    reply: `Pour créer un produit, indiquez une information à la fois à Ashy dans le chat principal :

• Nom du produit
• Prix d'achat
• Prix de vente

Exemple : « Nouveau produit : Craie scolaire, achat $5, vente $8 ».`,
  },
  {
    test: /comment\s+(ajouter|mettre|enregistrer).*(stock)/i,
    reply: `Une fois le produit créé, demandez à Ashy d'ajouter du stock dans le chat principal :

« Ajoute 100 boîtes de Craie scolaire en stock »

Sans produit, le stock ne peut pas être enregistré.`,
  },
  {
    test: /comment\s+(modifier|changer)\s+(un\s+)?produit/i,
    reply: `Demandez la modification à Ashy dans le chat principal, par exemple :

« Modifie le prix de vente de Craie scolaire à $9 »
« Change le nom du produit X en Y »`,
  },
  {
    test: /comment\s+(g[ée]n[ée]rer|faire|obtenir).*(rapport|bilan|pdf)/i,
    reply: `Écrivez simplement à Ashy dans le chat principal :

« Génère mon bilan PDF »

Ashy prépare le rapport à partir de vos ventes, dépenses et stocks.`,
  },
  {
    test: /comment\s+(ajouter|enregistrer)\s+(une\s+)?d[ée]pense/i,
    reply: `Écrivez vos dépenses à Ashy dans le chat principal :

• « J'ai payé le transport $10 »
• « Paiement électricité $30 »

Une dépense à la fois.`,
  },
];

export function localAshyReply(text) {
  const t = (text || '').trim();
  if (!t) return null;
  if (needsHumanEscalation(t)) {
    return {
      type: 'escalate',
      reply: 'Je vais transmettre votre demande à notre équipe support.',
    };
  }
  for (const item of FAQ) {
    if (item.test.test(t)) {
      return { type: 'faq', reply: item.reply };
    }
  }
  return {
    type: 'human',
    reply: 'Votre message a été envoyé au Service client. Notre équipe vous répondra ici dans ce même panneau.',
  };
}

async function resolveClientIdentity(user, pocketBaseToken) {
  let clientPublicId = '';
  let email = String(user?.email || '').trim().toLowerCase();
  let displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
    || user?.name
    || email
    || 'Client';

  try {
    const token = pocketBaseToken || pb?.authStore?.token;
    if (token && supabase) {
      const clientId = await createDashboardSession(token);
      const { data } = await supabase
        .from('clients')
        .select('id,user_id,email,nom_client')
        .eq('id', clientId)
        .maybeSingle();
      if (data?.user_id) clientPublicId = String(data.user_id);
      if (data?.email) email = String(data.email).trim().toLowerCase();
      if (data?.nom_client && !user?.firstName && !user?.lastName) {
        displayName = String(data.nom_client);
      }
    }
  } catch {
    /* fallback below */
  }

  if (!clientPublicId) clientPublicId = String(user?.id || '');
  return { clientPublicId, email, displayName };
}

/**
 * Send a Service client message to human support (Telegram) via the support-bridge.
 * Falls back to the legacy VITE_TELEGRAM_SUPPORT_WEBHOOK if configured.
 */
export async function escalateToTelegramSupport({
  user,
  message,
  chatId,
  pocketBaseToken,
}) {
  const token = pocketBaseToken || pb?.authStore?.token || '';
  const identity = await resolveClientIdentity(user, token);

  // Preferred path: secure edge function (server holds Telegram bot token).
  if (SUPPORT_BRIDGE_URL && token) {
    try {
      const res = await fetch(SUPPORT_BRIDGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          Accept: 'application/json; charset=UTF-8',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          source: 'ashy-support',
          message,
          chatId: chatId || '',
          supportChatId: chatId || '',
          clientPublicId: identity.clientPublicId,
          email: identity.email,
          displayName: identity.displayName,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      return {
        sent: res.ok && payload?.sent !== false,
        status: res.status,
        via: 'support-bridge',
        identity,
        payload,
      };
    } catch (err) {
      return { sent: false, reason: err?.message || 'network', via: 'support-bridge' };
    }
  }

  // Legacy webhook path (n8n), if still configured.
  if (!TELEGRAM_WEBHOOK) {
    return { sent: false, reason: 'no_webhook' };
  }
  try {
    const res = await fetch(TELEGRAM_WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        source: 'ashy-support',
        userId: user?.id || '',
        clientPublicId: identity.clientPublicId,
        email: identity.email,
        firstName: user?.firstName || '',
        lastName: user?.lastName || '',
        displayName: identity.displayName,
        chatId: chatId || '',
        message,
        createdAt: new Date().toISOString(),
      }),
    });
    return { sent: res.ok, status: res.status, via: 'legacy-webhook', identity };
  } catch (err) {
    return { sent: false, reason: err?.message || 'network', via: 'legacy-webhook' };
  }
}

export function telegramEscalationConfigured() {
  return Boolean(SUPPORT_BRIDGE_URL || TELEGRAM_WEBHOOK);
}
