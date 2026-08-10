import { needsHumanEscalation } from '@/lib/onboardingChecks';

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
    type: 'fallback',
    reply: `Vous êtes sur le Service client (compte, technique, abonnement).

Pour produits, stock, ventes, dépenses et rapports, parlez à Ashy dans le chat principal.

Décrivez ici un problème de compte, d'abonnement ou un bug technique et nous vous aiderons.`,
  };
}

/**
 * Escalate to human support (Telegram webhook if configured).
 * Never call this during onboarding tutorial mode.
 */
export async function escalateToTelegramSupport({ user, message, chatId }) {
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
        email: user?.email || '',
        firstName: user?.firstName || '',
        lastName: user?.lastName || '',
        chatId: chatId || '',
        message,
        createdAt: new Date().toISOString(),
      }),
    });
    return { sent: res.ok, status: res.status };
  } catch (err) {
    return { sent: false, reason: err?.message || 'network' };
  }
}

export function telegramEscalationConfigured() {
  return Boolean(TELEGRAM_WEBHOOK);
}
