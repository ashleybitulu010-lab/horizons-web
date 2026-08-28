# Ash Ledger — Audit de migration backend

> Phase 0 — inspection réalisée le 28 août 2026. Aucune migration métier n8n effectuée dans cette phase.

## A. Architecture actuelle

```
Navigateur (React/Vite — apps/web)
    │
    ├─► PocketBase (apps/pocketbase) — authentification utilisateur
    │
    ├─► Supabase (PostgREST + Realtime + Edge Functions) — données métier
    │       └─ Edge Functions : dashboard-session, support-bridge
    │
    └─► API Express (apps/api) via /hcgi/api
            ├─ POST /chat        → webhook n8n (Ash Ledger Bot)
            ├─ POST /history     → webhook n8n
            ├─ GET/POST /thread  → webhook n8n
            ├─ POST /auth/*      → PocketBase + webhooks n8n (airtable-id)
            └─ GET /health       → ping simple { status: 'ok' }
```

**n8n** reste le moteur conversationnel et d’orchestration métier aujourd’hui. Les scripts `tools/_*.mjs` et les nodes Code (`tools/_analyser_*.js`, `_prep_*.js`) maintiennent le workflow principal (`PbTaup5w5sb7tK7W`).

**Supabase** est la source de vérité unique pour ventes, dépenses, stocks, produits, clients, dettes, synthèse mensuelle, etc. La mémoire conversationnelle (`clients.thread_id`) vit aussi dans Supabase mais n’est pas une vérité financière.

---

## B. Architecture détectée

| Zone | Emplacement | Rôle |
|------|-------------|------|
| Frontend | `apps/web/src/` | React 18, Vite, React Router |
| Point d’entrée | `apps/web/src/main.jsx`, `App.jsx` | Bootstrap + routing |
| Auth frontend | `apps/web/src/hooks/useAuth.jsx`, `lib/pocketbaseClient.js` | Session PocketBase |
| Supabase client (navigateur) | `apps/web/src/lib/supabaseRest.js` | Anon key + session dashboard |
| API client | `apps/web/src/lib/apiServerClient.js` | Préfixe `/hcgi/api` |
| Chat | `apps/web/src/context/ChatContext.jsx` | Messages → `POST /chat` |
| Dashboard | `apps/web/src/hooks/useDashboardData.js` | Supabase direct + realtime |
| Backend existant | `apps/api/src/` | Express 5 (déjà en place) |
| Auth backend | `apps/api/src/utils/pocketbaseClient.js` | Superuser PB pour routes auth |
| Migrations SQL | `supabase/migrations/` | Schéma + RLS |
| Edge Functions | `supabase/functions/` | Sessions dashboard, support |
| Outils n8n | `tools/` | Déploiement / tests workflows |
| Monorepo | `package.json` (racine parente) | `dev` lance web + api + pocketbase |

**Pas de second backend** détecté. `apps/api` est le point d’intégration retenu pour le socle Ash Ledger.

---

## C. Accès actuel à Supabase

### Création du client

- **Frontend** : `createClient(SUPABASE_URL, VITE_SUPABASE_ANON_KEY)` dans `supabaseRest.js`.
- **Edge Function `dashboard-session`** : service role côté Deno pour lier PocketBase → client Supabase + JWT scoped.
- **Backend Express** : client admin via `SUPABASE_SERVICE_ROLE_KEY` (serveur uniquement).

### Identification utilisateur

1. L’utilisateur s’authentifie via **PocketBase** (`useAuth.jsx`).
2. `createDashboardSession(pocketBaseToken)` appelle l’Edge Function qui résout/crée la ligne `clients` et retourne une session Supabase Auth (RLS).
3. Le frontend utilise ensuite le JWT Supabase pour REST/realtime.

### Accès direct depuis le navigateur

| Module | Opérations |
|--------|------------|
| `useDashboardData.js` | SELECT + realtime sur produits, stocks, ventes, depenses, paiements_dettes, synthese_mensuelle |
| `supabaseRest.js` | resolveClientId, supabaseSelect, supabaseCount, session |
| `activityConfig.js` | Lecture/écriture config activité (`clients`) |
| `currency.js` | Préférences devise (`clients`) |
| `onboardingChecks.js` | Comptages onboarding |
| `SubscriptionPage.jsx` | Abonnement client |
| `ashyAssistant.js` | Lecture client (assistant local) |

Les écritures métier complexes passent aujourd’hui surtout par **n8n** (webhook chat), pas par le backend Express.

---

## D. Chat / Ashy actuel

1. `ChatContext` envoie `POST /hcgi/api/chat` avec `message`, `userId`, identité utilisateur.
2. `apps/api/src/routes/chat.js` relaie vers `N8N_CHAT_WEBHOOK` (ou `N8N_WEBHOOK_URL`).
3. n8n exécute le pipeline : Agent Central → Analyser Intention → collecte / outils / Supabase HTTP.
4. La réponse texte (ou PDF base64) remonte au frontend.
5. Historique : `POST /history`, thread : `GET /thread/:userId`, `POST /thread/message` (également via n8n).
6. Messages locaux persistés dans `localStorage` ; thread serveur dans Supabase via n8n.

Aucune logique agent complète n’existe encore dans `apps/api` — uniquement proxy HTTP.

---

## E. Points de migration

| Élément | Classification |
|---------|----------------|
| `apps/api` Express, middleware sécurité | **À conserver** — socle backend |
| Routes chat/history/thread n8n | **À conserver** temporairement — ne pas couper |
| PocketBase auth | **À conserver** — ne pas migrer vers Supabase Auth |
| Schéma Supabase + RLS | **À ne pas toucher** pour l’instant |
| Client Supabase anon frontend | **À déplacer progressivement** vers backend pour écritures sensibles |
| Logique métier n8n (nodes Code) | **À déplacer progressivement** vers `apps/api` services + tools |
| `dashboard-session` Edge Function | **À conserver** — pont auth PB → Supabase |
| Realtime dashboard frontend | **À conserver** — refactor possible plus tard |
| Scripts `tools/_*.mjs` | **À conserver** — ops n8n / déploiement |
| `supabaseRest.js` helpers | **À refactoriser** à terme (API backend) |

---

## F. Risques

| Risque | Détail | Mitigation phase 0 |
|--------|--------|---------------------|
| **Sécurité** | Anon key + JWT côté navigateur ; RLS comme barrière | Service role strictement serveur ; route Supabase ping protégée |
| **Exposition clés** | `VITE_*` visibles dans le bundle | Jamais de service role en frontend ; audit `.env.example` |
| **Accès direct données** | Frontend lit/écrit via PostgREST | Backend centralisera les écritures métier plus tard |
| **Duplication logique** | Règles métier dans n8n Code nodes | Contrat Ashy ↔ Supabase documenté ; tools backend préparés |
| **Dépendance n8n** | Chat et batch dépendent du webhook | Proxy conservé ; migration incrémentale |
| **Concurrence frontend/backend** | Deux chemins d’écriture possibles | Phase 0 sans nouvelles routes métier |
| **Incohérence données** | Mémoire thread vs état Supabase | Documenter : Supabase = vérité ; thread = contexte seulement |

---

## Décision d’implémentation (Phase 2)

- **Ne pas créer** `backend/` séparé.
- **Étendre** `apps/api` avec `config/`, `supabase/`, `agent/`, `tools/`, `services/`, routes `/api/*`.
- **Conserver** `/health` existant + ajouter `GET /api/health` structuré.
- **Aucune modification** frontend, n8n, tables Supabase dans cette phase.
