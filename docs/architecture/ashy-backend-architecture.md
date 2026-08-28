# Ash Ledger — Architecture backend Ashy

> Socle préparatoire. n8n reste actif en parallèle jusqu’à migration progressive.

## Vue d’ensemble

```
Frontend (apps/web)
        │
        ▼
Backend Ash Ledger (apps/api)
        │
        ├── Auth / contexte utilisateur (PocketBase aujourd’hui)
        ├── API REST (/api/*)
        ├── Agent Ashy (orchestration — stub phase 0)
        ├── Tools métier (interfaces — stub phase 0)
        └── Accès Supabase (service role, serveur uniquement)
                │
                ▼
        Supabase (source de vérité métier)
                ▲
                │ (temporaire, en parallèle)
        n8n — webhooks chat / batch / automatisations
```

## Responsabilités par couche

| Couche | Rôle |
|--------|------|
| **Frontend** | UI, session PB, dashboard realtime, appels API |
| **Backend** | Sécurité, validation, auth context, futures routes métier |
| **Ashy (agent)** | Intelligence, dialogue, choix d’outils — pas de vérité financière locale |
| **Tools** | Opérations atomiques métier (get_sales, create_sale, …) |
| **Supabase** | Persistance, RLS, triggers, vues, realtime |
| **n8n (temporaire)** | Orchestration actuelle du chat et automatisations périphériques |

## Contrat Ashy ↔ Supabase

Ce contrat est **non négociable** pour toute évolution du backend :

1. **Supabase = vérité métier.** Ventes, dépenses, stocks, dettes, produits : toujours lire/écrire via Supabase (directement ou via tools backend).
2. **Ashy = intelligence et orchestration.** Le thread conversationnel et la mémoire LLM ne remplacent jamais une requête métier à jour.
3. **Backend = sécurité, validation, accès contrôlé.** Secrets serveur, service role, rate limits, audit.
4. **Pas de vérité financière dans la mémoire conversationnelle.** `clients.thread_id` est un contexte UX, pas un ledger.
5. **Lecture fraîche quand l’exactitude compte.** Totaux, soldes, stock : re-fetch Supabase via tool/service.
6. **Écriture réussie = confirmation Supabase.** Pas de succès utilisateur si l’INSERT/UPDATE/RPC a échoué.
7. **Erreurs Supabase transparentes.** Ne jamais masquer une erreur DB derrière un message de succès.

Implémentation de référence : `apps/api/src/agent/contract.js`.

## Routes API (phase 0)

| Route | Auth | Description |
|-------|------|-------------|
| `GET /health` | Public | Compatibilité existante `{ status: 'ok' }` |
| `GET /api/health` | Public | Santé structurée du backend |
| `GET /api/supabase/status` | Clé interne (`x-ash-internal-key`) | Test connectivité Supabase sans données sensibles |

Les routes métier (`/api/sales`, etc.) seront ajoutées lors des phases suivantes.

## Structure `apps/api`

```
apps/api/
├── src/
│   ├── config/          # Variables d'environnement typées
│   ├── middleware/      # Erreurs, rate limit, auth interne
│   ├── routes/          # Routes existantes + /api/*
│   ├── supabase/        # Client serveur + ping
│   ├── services/        # Règles métier (futur)
│   ├── agent/           # Orchestrateur Ashy (stub)
│   └── tools/           # Registre d'outils métier (stub)
├── tests/
└── README.md
```

## Variables d’environnement (serveur)

Voir `apps/api/.env.example`. Jamais committer `.env`.

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — accès backend
- `ASH_INTERNAL_HEALTH_KEY` — protection route status Supabase
- `N8N_*`, `PB_*` — existantes, inchangées

## n8n en parallèle

Jusqu’à migration explicite :

- `POST /chat`, `/history`, `/thread/*` continuent de proxy n8n.
- Aucun workflow n8n supprimé ou modifié dans la phase 0.
- Les tools backend remplaceront progressivement les nodes Code n8n **un par un**, avec tests E2E.

## Prochaines phases (hors scope actuel)

1. Middleware auth utilisateur (JWT PocketBase → contexte client Supabase).
2. Implémentation réelle des tools (`get_sales`, `create_expense`, …).
3. Route chat alternative passant par l’agent backend (feature flag).
4. Réduction des écritures directes frontend → Supabase.
5. Repositionnement n8n vers automatisations périphériques (notifications, cron).
