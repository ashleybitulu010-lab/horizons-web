import {
  ASHY_EXPLANATION,
  ASHY_GREETING,
  ASHY_WELCOME,
} from '@/lib/brandAssets';

export function buildWelcomeContent(firstName) {
  const name = String(firstName || '').trim();
  const hello = name ? `Bonjour ${name} 👋` : 'Bonjour 👋';
  return `${hello}

Comment je peux t’aider aujourd’hui ?`;
}

export function makeWelcomeMessage(firstName) {
  return {
    id: 'welcome',
    role: 'assistant',
    content: buildWelcomeContent(firstName),
    time: '09:00',
    status: 'read',
  };
}

/**
 * Official Ashy poses only — mapped by message context.
 * Available assets: greeting, explanation (phone), welcome, success.
 */
export function ashyPoseForText(content, { typing = false } = {}) {
  if (typing) return ASHY_EXPLANATION;
  const t = String(content || '').toLowerCase();
  if (/erreur|impossible|connexion|vérifie|verifie|⚠️|⚠|échec|echec/.test(t)) {
    return ASHY_GREETING;
  }
  if (/enregistr|succès|succes|bravo|✅|✓|c’est noté|c'est noté/.test(t)) {
    return ASHY_EXPLANATION;
  }
  if (/n[’']ai pas encore trouvé|aucune donnée|pas de données|aucun résultat/.test(t)) {
    return ASHY_GREETING;
  }
  if (/analyse|rapport|bilan|période|statistique|insight/.test(t)) {
    return ASHY_WELCOME;
  }
  if (/détect|detect|compris|voici ce que|récap|recap/.test(t)) {
    return ASHY_EXPLANATION;
  }
  if (/bonjour|bienvenue|gère aujourd|gere aujourd/.test(t)) {
    return ASHY_GREETING;
  }
  return ASHY_EXPLANATION;
}

export const CHAT_SUGGESTIONS = [
  {
    id: 'vente',
    label: 'Vente',
    hint: "J'ai vendu...",
    draft: "J'ai vendu ",
    color: '#16A384',
  },
  {
    id: 'depense',
    label: 'Dépense',
    hint: "J'ai dépensé...",
    draft: "J'ai dépensé ",
    color: '#FF7000',
  },
  {
    id: 'produit',
    label: 'Produit',
    hint: 'Ajouter un produit...',
    draft: 'Je veux ajouter un nouveau produit',
    send: true,
    color: '#7C3AED',
  },
  {
    id: 'stock',
    label: 'Stock',
    hint: "J'ai reçu du stock...",
    draft: "J'ai reçu du stock ",
    color: '#173B73',
  },
  {
    id: 'dette',
    label: 'Dette',
    hint: 'Un client me doit...',
    draft: 'Un client me doit ',
    color: '#D64545',
  },
];

export const QUICK_ADD_ITEMS = [
  {
    id: 'vente',
    title: 'Nouvelle vente',
    subtitle: 'Enregistrer une vente',
    draft: "J'ai vendu ",
    color: '#16A384',
    icon: 'vente',
  },
  {
    id: 'depense',
    title: 'Nouvelle dépense',
    subtitle: 'Enregistrer une dépense',
    draft: "J'ai dépensé ",
    color: '#FF7000',
    icon: 'graph',
  },
  {
    id: 'produit',
    title: 'Nouveau produit',
    subtitle: 'Ajouter un produit',
    draft: 'Je veux ajouter un nouveau produit',
    send: true,
    color: '#7C3AED',
    icon: 'produit',
  },
  {
    id: 'stock',
    title: 'Entrée de stock',
    subtitle: 'Ajouter du stock',
    draft: "J'ai reçu du stock : ",
    color: '#2563EB',
    icon: 'stock',
  },
  {
    id: 'dette',
    title: 'Dette client',
    subtitle: 'Ajouter une dette',
    draft: 'Un client me doit ',
    color: '#D64545',
    icon: 'dette',
  },
  {
    id: 'paiement',
    title: 'Paiement reçu',
    subtitle: 'Enregistrer un paiement',
    draft: "J'ai reçu un paiement de ",
    color: '#16A384',
    icon: 'vente',
  },
  {
    id: 'transfert',
    title: "Transfert d'argent",
    subtitle: 'Transférer entre caisses/comptes',
    draft: 'Transfère ',
    color: '#173B73',
    icon: 'rapport',
  },
];

export const PROFILE_HUB_LINKS = [
  { id: 'dashboard', label: "Vue d'ensemble", to: '/dashboard' },
  { id: 'reports', label: 'Mes rapports', to: '/reports' },
  { id: 'ventes', label: 'Ventes', draft: "J'ai vendu " },
  { id: 'depenses', label: 'Dépenses', draft: "J'ai dépensé " },
  { id: 'stock', label: 'Stock', draft: "J'ai reçu du stock " },
  { id: 'produits', label: 'Produits', draft: 'Je veux ajouter un nouveau produit', send: true },
  { id: 'clients', label: 'Clients', draft: 'Ajoute un client : ' },
  { id: 'dettes', label: 'Dettes', draft: 'Un client me doit ' },
  { id: 'settings', label: 'Paramètres', to: '/settings' },
  { id: 'support', label: 'Aide & Support', action: 'support' },
];
