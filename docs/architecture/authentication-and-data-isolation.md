# Ash Ledger — Authentification et isolation des données

> Phase 1 — identité utilisateur backend. n8n et PocketBase restent en place.

## 1. Système d'authentification actuel

| Couche | Mécanisme |
|--------|-----------|
| **Frontend** | PocketBase SDK (`/hcgi/platform`) — `authWithPassword`, session dans `pb.authStore` |
| **Token** | JWT PocketBase utilisateur (`useAuth().token`) |
| **Supabase dashboard** | Edge Function `dashboard-session` — lie PB → `clients.auth_user_id` + JWT Supabase |
| **Backend API (Phase 1)** | Vérification du token PocketBase via `POST /api/collections/users/auth-refresh` |

Le frontend **ne passe pas** par `/auth/login` du backend pour la connexion principale — il s'authentifie directement contre PocketBase, puis envoie `Authorization: Bearer <token>` aux routes API (`/chat`, `/history`, `/thread/message`).

Les routes `/auth/signup` et `/auth/login` du backend restent disponibles (webhooks n8n / dev), sans remplacer le flux PocketBase principal.

## 2. Flux frontend → backend

```
Utilisateur connecté (PocketBase)
        │
        ▼
ChatContext / useAuth
        │
        ▼
Authorization: Bearer <pocketbase_user_token>
        │
        ▼
apps/api middleware requireAuth
        │
        ▼
verifyPocketBaseToken() → auth-refresh PocketBase
        │
        ▼
buildRequestUser() → req.user
        │
        ▼
Route métier (chat, history, thread…)
```

## 3. Comment le backend identifie l'utilisateur

1. Extraction du header `Authorization` (support `Bearer`).
2. Appel PocketBase `auth-refresh` avec le token (`POCKETBASE_URL`).
3. Construction de `req.user` :

| Champ | Description |
|-------|-------------|
| `id` | ID PocketBase (preuve d'identité) |
| `email`, `firstName`, `lastName` | Profil minimal |
| `airtableId` | Identifiant métier legacy si présent |
| `businessUserId` | `airtableId \|\| id` — utilisé par n8n (miroir frontend `resolveStorageId`) |
| `clientId` | UUID ligne `clients` Supabase (si trouvé) |
| `supabaseAuthUserId` | `clients.auth_user_id` |
| `clientUserId` | `clients.user_id` |

## 4. Contexte utilisateur (`req.user`)

Attaché par `requireAuth` dans `apps/api/src/middleware/auth.js`.

Route de diagnostic : `GET /api/me` (authentifiée).

Les futurs tools Ashy doivent utiliser `createToolExecutionContext(req)` (`apps/api/src/tools/context.js`) — **jamais** un `userId` fourni par le modèle.

## 5. Appels Supabase côté backend

- Client admin : service role (`apps/api/src/supabase/client.js`).
- Résolution client : `resolveSupabaseClientRow()` cherche `clients.user_id` parmi `[airtableId, id, email]`.
- Accès scoped : `apps/api/src/services/supabase-scoped.js` — filtres explicites par `clientId`.

## 6. Isolation des données

**Principe :** Utilisateur A ne peut pas agir pour B.

Middleware `rejectForeignIdentity` : compare `userId`, `user_id`, `pbUserId` (body/params) aux identités autorisées de `req.user` → **403** si mismatch.

Les handlers chat/history/thread utilisent **uniquement** `req.user.businessUserId` / `req.user.id` pour les appels n8n — pas le body client.

## 7. Service Role Key

Utilisée uniquement serveur (`SUPABASE_SERVICE_ROLE_KEY`). Jamais exposée au frontend ni dans les réponses API.

## 8. RLS et limites avec Service Role

**Observé dans les migrations :**

- Tables : `clients`, `produits`, `stocks`, `ventes`, `depenses`, `paiements_dettes`
- Isolation RLS : `clients.auth_user_id = auth.uid()` et `ash_owns_client(client_id)` pour les tables filles
- `clients.user_id` : identifiant métier PocketBase / Airtable
- Commentaire migration : *service_role bypasses RLS (n8n / edge functions / API)*

**Conséquence :** avec la service role, **RLS ne s'applique pas**. Toute requête backend doit filtrer explicitement par `req.user.clientId` via `supabase-scoped.js`.

## 9. Routes protégées (Phase 1)

| Route | Protection |
|-------|------------|
| `GET /health`, `GET /api/health` | Public |
| `GET /api/supabase/status` | Clé interne |
| `POST /auth/signup`, `POST /auth/login` | Public |
| `GET /api/me` | `requireAuth` |
| `POST /chat`, `/history`, `/thread/*` | `requireAuth` + `rejectForeignIdentity` |
| `GET /thread/:userId` | `requireAuth` + `assertParamUserIsSelf` |
| `POST /auth/airtable-id` | `requireAuth` |

n8n continue de recevoir les requêtes proxifiées — seule l'identité envoyée est désormais **certifiée** par le backend.

## 10. Stratégie de migration future

1. Implémenter les tools Ashy avec `createToolExecutionContext(req)` + `supabase-scoped`.
2. Optionnel : JWT Supabase côté backend pour bénéficier du RLS natif (réduire la dépendance à la service role).
3. Déprécier progressivement la confiance aux identifiants body côté n8n.
4. Conserver PocketBase jusqu'à migration auth explicite.

## Journalisation

`apps/api/src/middleware/auth-log.js` — événements auth sans tokens ni secrets.

## Erreurs structurées

```json
{ "error": { "code": "UNAUTHENTICATED", "message": "Authentication required" } }
{ "error": { "code": "FORBIDDEN", "message": "Cannot act on behalf of another user" } }
```
