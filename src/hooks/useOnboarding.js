import { useCallback, useEffect, useMemo, useState } from 'react';

export const ONBOARDING_STORAGE_PREFIX = 'ash_onboarding_';
export const ONBOARDING_RELAUNCH_EVENT = 'ash:relaunch-guide';

export const ONBOARDING_STEPS = [
  {
    id: 'produit',
    index: 1,
    percent: 20,
    title: 'Créer un produit',
    explain: `Créons votre premier produit.

Exemple :
Nom : Craie scolaire
Prix d'achat : 800 FC
Prix de vente : 1800 FC

Écrivez une seule information à la fois dans le chat principal.`,
    success: 'Bravo ! Votre premier produit est enregistré.',
    check: 'produit',
  },
  {
    id: 'stock',
    index: 2,
    percent: 40,
    title: 'Ajouter du stock',
    explain: `Maintenant que le produit existe, nous pouvons ajouter du stock.

Exemple :
Produit : Craie scolaire
Quantité : 100 boîtes

Une seule donnée à la fois, dans le chat principal.`,
    success: 'Excellent ! Votre stock est prêt.',
    check: 'stock',
  },
  {
    id: 'vente',
    index: 3,
    percent: 60,
    title: 'Enregistrer une vente',
    explain: `On ne peut jamais vendre un produit qui n'existe pas ou qui n'a pas de stock.

Les ventes peuvent être écrites naturellement, par exemple :
• J'ai vendu 10 boîtes de craies scolaires.
• Vente de 5 boîtes.
• Un client a acheté 3 boîtes.

Aucune syntaxe particulière n'est demandée. Ashy comprend automatiquement.`,
    success: 'Parfait ! Votre vente est enregistrée.',
    check: 'vente',
  },
  {
    id: 'depense',
    index: 4,
    percent: 80,
    title: 'Enregistrer une dépense',
    explain: `Même principe pour les dépenses — écrivez naturellement :

• J'ai payé le transport 5000 FC.
• J'ai acheté des cartons 12000 FC.
• Paiement électricité 30000 FC.

Aucune structure rigide n'est demandée. Une seule dépense à la fois.`,
    success: 'Super ! Votre dépense est enregistrée.',
    check: 'depense',
  },
  {
    id: 'rapport',
    index: 5,
    percent: 100,
    title: 'Générer un rapport',
    explain: `Dernière étape : écrivez dans le chat principal :

« Génère mon bilan PDF »

Le rapport sera généré automatiquement.`,
    success: `🎉 Félicitations !
Vous maîtrisez maintenant les bases d'Ash Ledger.

À partir de maintenant, je suis votre assistant financier permanent.`,
    check: 'rapport',
  },
];

export const WELCOME_ONBOARDING = {
  id: 'onboarding-welcome',
  role: 'assistant',
  content: `👋 Bonjour, je suis Ashy, votre assistant financier IA.

Je vais vous apprendre à utiliser Ash Ledger en moins de 5 minutes.

Ensemble nous allons créer une petite entreprise fictive.
À chaque étape, je vérifierai que tout est correct avant de continuer.`,
  actions: [
    { id: 'start', label: 'Commencer le guide', variant: 'primary' },
    { id: 'skip', label: 'Passer le guide', variant: 'ghost' },
  ],
};

export const ORDER_RULE_MESSAGE = `Avant toute manipulation, retenez cet ordre obligatoire :

Une vente est impossible sans respecter cet ordre :
1. Produit
2. Stock
3. Vente

Si vous tentez une vente trop tôt, je vous le rappellerai.`;

export const ORDER_BLOCK_MESSAGE = `Impossible d'effectuer une vente.
Nous devons d'abord créer le produit puis enregistrer le stock.`;

export const ONE_DATA_REMINDER = 'Rappel : saisissez une seule donnée à la fois.';

export function storageKey(userId) {
  return `${ONBOARDING_STORAGE_PREFIX}${userId}`;
}

export function readOnboardingState(userId) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeOnboardingState(userId, state) {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function defaultOnboardingState(userCreatedAt) {
  const createdMs = userCreatedAt ? new Date(userCreatedAt).getTime() : Date.now();
  const ageMs = Number.isFinite(createdMs) ? Date.now() - createdMs : 0;
  // Existing accounts (older than 48h) without saved progress skip auto-tutorial.
  const isLikelyNew = ageMs < 48 * 60 * 60 * 1000;

  if (!isLikelyNew) {
    return {
      status: 'completed',
      stepIndex: ONBOARDING_STEPS.length - 1,
      completedAt: new Date().toISOString(),
      skippedAt: null,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    status: 'pending',
    stepIndex: 0,
    completedAt: null,
    skippedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export function getCurrentStep(state) {
  if (!state || state.status !== 'active') return null;
  return ONBOARDING_STEPS[state.stepIndex] || null;
}

export function progressFromState(state) {
  if (!state) return { percent: 0, label: '', step: 0, total: ONBOARDING_STEPS.length };
  if (state.status === 'completed') {
    return {
      percent: 100,
      label: 'Terminé',
      step: ONBOARDING_STEPS.length,
      total: ONBOARDING_STEPS.length,
    };
  }
  if (state.status !== 'active') {
    return { percent: 0, label: '', step: 0, total: ONBOARDING_STEPS.length };
  }
  const step = ONBOARDING_STEPS[state.stepIndex];
  if (!step) {
    return {
      percent: 100,
      label: 'Terminé',
      step: ONBOARDING_STEPS.length,
      total: ONBOARDING_STEPS.length,
    };
  }
  return {
    percent: step.percent,
    label: step.title,
    step: step.index,
    total: ONBOARDING_STEPS.length,
  };
}

export function requestRelaunchGuide() {
  try {
    window.dispatchEvent(new CustomEvent(ONBOARDING_RELAUNCH_EVENT));
  } catch {
    /* ignore */
  }
}

export function useOnboarding(userId, userCreatedAt) {
  const [state, setState] = useState(() => {
    if (!userId) return null;
    return readOnboardingState(userId) || defaultOnboardingState(userCreatedAt);
  });

  useEffect(() => {
    if (!userId) {
      setState(null);
      return;
    }
    setState(readOnboardingState(userId) || defaultOnboardingState(userCreatedAt));
  }, [userId, userCreatedAt]);

  const persist = useCallback(
    (next) => {
      const withStamp = { ...next, updatedAt: new Date().toISOString() };
      setState(withStamp);
      writeOnboardingState(userId, withStamp);
      return withStamp;
    },
    [userId],
  );

  const startGuide = useCallback(() => {
    return persist({
      status: 'active',
      stepIndex: 0,
      completedAt: null,
      skippedAt: null,
    });
  }, [persist]);

  const skipGuide = useCallback(() => {
    return persist({
      status: 'skipped',
      stepIndex: 0,
      completedAt: null,
      skippedAt: new Date().toISOString(),
    });
  }, [persist]);

  const advanceStep = useCallback(() => {
    setState((prev) => {
      if (!prev || prev.status !== 'active') return prev;
      const nextIndex = (prev.stepIndex || 0) + 1;
      let next;
      if (nextIndex >= ONBOARDING_STEPS.length) {
        next = {
          ...prev,
          status: 'completed',
          stepIndex: ONBOARDING_STEPS.length - 1,
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      } else {
        next = {
          ...prev,
          stepIndex: nextIndex,
          updatedAt: new Date().toISOString(),
        };
      }
      writeOnboardingState(userId, next);
      return next;
    });
  }, [userId]);

  const completeGuide = useCallback(() => {
    return persist({
      status: 'completed',
      stepIndex: ONBOARDING_STEPS.length - 1,
      completedAt: new Date().toISOString(),
      skippedAt: null,
    });
  }, [persist]);

  const restartGuide = useCallback(() => {
    return persist({
      status: 'pending',
      stepIndex: 0,
      completedAt: null,
      skippedAt: null,
    });
  }, [persist]);

  const progress = useMemo(() => progressFromState(state), [state]);
  const currentStep = useMemo(() => getCurrentStep(state), [state]);
  const isGuideMode = state?.status === 'pending' || state?.status === 'active';
  const isActive = state?.status === 'active';
  const isPending = state?.status === 'pending';

  return {
    state,
    progress,
    currentStep,
    isGuideMode,
    isActive,
    isPending,
    startGuide,
    skipGuide,
    advanceStep,
    completeGuide,
    restartGuide,
  };
}
