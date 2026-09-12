# ADR — Multi-Activity, Multi-Tenant & Admin Architecture

## Status

**Accepted**

Architecture validée le 2026-09-09 comme référence officielle pour les phases futures multi-activité et administration (Control Center). Les implémentations en cours (F4-B2-C et suivantes) restent au scope tenant `client_id` jusqu'à la phase P1 `activities`.

## Date

2026-09-09

## Context

Ash Ledger migre progressivement de n8n vers un backend dédié (`apps/api`) avec Ashy comme agent unique. L’architecture actuelle est :

- **Multi-tenant** au niveau `client_id` (table `public.clients`).
- **Mono-activité** : `clients.type_activite` et `clients.nom_activite` décrivent une seule activité par tenant.
- **Ashy** opère sans `activeActivityId` ; les outils et services filtrent uniquement par `client_id`.
- **Sessions** : `agent_sessions` est unique par `(client_id, state_type)` ; `chat_messages` est scopé par `client_id`.
- **Idempotence durable (F4-B2-B)** : `agent_write_operations` avec `UNIQUE(client_id, operation_id)`.
- **Admin** : aucun RBAC applicatif ; le backend utilise `service_role` (RLS contournée) et scope explicite via `requireClientScope`.
- **n8n** reste actif en parallèle (chat legacy, login, batch ops).

Phases validées : F4-B1 (GO), F4-B2-A (GO), F4-B2-B (GO WITH RESERVATION — aucune régression B2-B démontrée).

Cet ADR fixe le modèle cible **avant** d’ajouter de nouvelles activités métier (Services, Production) et avant le Control Center administrateur.

## Problem

1. Une entreprise peut exercer **plusieurs activités** (Commerce, Services, Production) sous la **même identité** — le modèle actuel mélange tout sous un seul `client_id`.
2. `clients.type_activite` ne peut pas représenter plusieurs activités sans dupliquer artificiellement les tenants (anti-pattern).
3. Un seul pending Ashy/n8n par `client_id` peut faire s’écraser les confirmations entre activités.
4. Il n’existe pas de plan admin distinct du scope utilisateur métier.
5. Sans décision explicite maintenant, chaque phase (B2-C, nouveaux tools, dashboard) risque de figer un modèle mono-activité difficile à migrer.

## Goals

- Permettre **un utilisateur → un tenant → plusieurs activités → données isolées par activité**.
- Conserver **un seul agent Ashy** avec routage conscient du contexte d’activité.
- Préserver l’**isolation tenant** existante (`client_id`).
- Préparer les **fondations Control Center** (admin ≠ client) sans les implémenter.
- Permettre une **migration additive** depuis l’état actuel sans casser n8n, F4-B1, F4-B2-B, ni les utilisateurs existants.
- Donner des conventions stables pour B2-C/D/E et les phases multi-activité ultérieures.

## Non-Goals

- Créer tables, migrations ou code dans cet ADR.
- Implémenter le Control Center UI.
- Implémenter les activités Services / Production.
- Remplacer PocketBase ou n8n immédiatement.
- Définir le catalogue complet d’outils par type d’activité.
- Résoudre tous les problèmes de flaky tests CI (hors scope ADR).

## Current Architecture

```
PocketBase (auth) → buildRequestUser() → req.user.clientId
                                              ↓
                         requireClientScope(user) → client_id
                                              ↓
                    ventes | depenses | produits | stocks | …
                                              ↓
                    agent_sessions (1 draft + 1 pending / client)
                    chat_messages (historique / client)
                    agent_write_operations (idempotence / client)
```

**Termes code actuels :**

| Concept ADR | Nom dans le code / SQL |
|-------------|------------------------|
| Tenant | `clients` / `client_id` / `clientId` |
| Activity (config only) | `clients.type_activite`, `clients.nom_activite` |
| User identity | PocketBase `id`, `businessUserId`, `auth_user_id` |

---

## Decision

### 1. Tenant model

**Décision :** La table `public.clients` est et reste la **racine tenant** (organisation / entreprise).

**Terme officiel :** **Tenant** dans la documentation et les ADR futurs.  
**Alias code conservé :** `client`, `client_id`, `clientId` — **aucun rename de table** prévu.

**Interdit :** modéliser chaque activité comme un `clients` distinct pour la même entreprise.

```
✅ Tenant (clients) → N activities
❌ Client Commerce + Client Services + Client Production (même entreprise)
```

**Justification :** Un abonnement, une identité auth, une facturation et un espace admin observent le tenant. Les activités sont des subdivisions métier internes.

**Contrainte existante préservée :** `UNIQUE(clients.auth_user_id)` — un utilisateur auth Supabase ↔ un tenant (sauf évolution future explicite multi-utilisateur par tenant, hors scope).

---

### 2. Activity model

**Décision :** Introduire conceptuellement une entité **`activities`** :

```
clients (1) ──< activities (N)
```

**Schéma conceptuel (non implémenté) :**

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | uuid PK | |
| `client_id` | uuid FK → clients ON DELETE CASCADE | Tenant scope |
| `type` | text | `commerce`, `service`, `production`, `autre` (aligné sur check actuel) |
| `name` | text | Nom affiché (ex. « Boutique principale ») |
| `status` | text | ex. `active`, `archived` — une seule `active` par défaut au switch UI |
| `config` | jsonb nullable | Flags spécifiques activité (`gestion_stock`, `suivi_dettes`, …) |
| `is_default` | boolean | Activité par défaut du tenant (migration legacy) |
| `created_at`, `updated_at` | timestamptz | |

**`clients.type_activite` / `clients.nom_activite` :**

- **Ne deviennent PAS** la solution multi-activité.
- **Migration :** Phase 1 — créer une `activity` par tenant à partir de ces colonnes ; marquer `is_default = true`.
- **Phase 4 :** colonnes legacy **deprecated** (lecture fallback seulement), puis suppression planifiée.

**`clients.gestion_stock` / `clients.suivi_dettes` :**

- Migrer vers `activities.config` (ou colonnes dédiées sur `activities`) — **pas** rester tenant-global si les flags diffèrent par activité.

---

### 3. Data isolation

**Règle cible — double scope :**

```
tenant scope   : client_id   (obligatoire partout)
activity scope : activity_id (obligatoire sur données métier activity-specific)
```

**Classification :**

| Classe | Description | Exemples |
|--------|-------------|----------|
| **A — Tenant-global** | Partagé par toutes les activités du tenant | `clients`, abonnement, billing, config onboarding tenant |
| **B — Activity-specific** | Données métier isolées par activité | `ventes`, `depenses`, `produits`, `stocks`, `paiements_dettes`, KPI activity-level |
| **C — Session / conversation** | Contexte Ashy / chat | `agent_sessions`, `chat_messages` (avec `activity_id`) |
| **D — System / audit** | Ops backend, idempotence, admin | `agent_write_operations`, futur `admin_audit_log` |

**Par table métier :**

| Table | Activity-scoped ? | Justification |
|-------|-------------------|---------------|
| `ventes` | **Oui** | Ventes d’une boutique n’appartiennent pas à l’activité Production |
| `depenses` | **Oui** | Dépenses liées à l’activité courante |
| `produits` | **Oui** | Catalogue distinct Commerce vs matières premières Production |
| `stocks` | **Oui** | Stock par catalogue / activité |
| `paiements_dettes` | **Oui** | Lié à `ventes` activity-scoped |
| `synthese_mensuelle` | **Oui** (ou vue par activité + rollup tenant) | KPI par activité ; agrégat tenant optionnel en vue séparée |

**Tenant-scoped (pas de `activity_id`) :**

| Table | Justification |
|-------|---------------|
| `clients` | Racine tenant |
| `subscriptions` (future normalisation) | Un abonnement couvre le tenant entier |
| `activities` | Enfant direct du tenant |

---

### 4. Ashy context

**Décision :** Introduire **`activeActivityId`** dans le contexte d’exécution Ashy.

**Construction du contexte (cible) :**

```
requireAuth → buildRequestUser() → req.user
       ↓
resolveActiveActivity(req) → req.user.activeActivityId
       ↓
validateActivityBelongsToTenant(activeActivityId, clientId)
       ↓
createAshyContext(req) → { user, clientId, activeActivityId, permissions }
       ↓
createAshyAgent().run({ ..., context })
```

**Règles de scope (non négociables) :**

1. Le **modèle / le frontend ne fournissent jamais** `client_id` ni `activity_id` comme source de vérité pour les écritures.
2. `client_id` = dérivé de l’auth (`requireClientScope`).
3. `activity_id` = dérivé du contexte validé serveur (`requireActivityScope`).
4. Le frontend **peut demander** une activité (header `X-Ash-Activity-Id`, body `activityId`, ou cookie session) — le backend **doit rejeter** si `(activity_id, client_id)` ne correspond pas.
5. Liste des activités du tenant : endpoint dédié ou enrichissement `GET /api/me` — **jamais** liste globale.

**Abstraction cible (équivalent) :**

```javascript
requireClientScope(user)      // existant
requireActivityScope(user, activeActivityId)  // futur
assertActivityOwnership(user, activityId)     // futur
```

**Compatibilité mono-activité :** tant que `activities` n’existe pas en prod, `activeActivityId` = activité par défaut implicite (migration Phase 1).

---

### 5. Sessions

**Problème actuel :** `UNIQUE(client_id, state_type)` → un seul draft et un seul pending **par tenant**, risque d’écrasement inter-activités.

**Décision cible :**

```
agent_sessions : UNIQUE (client_id, activity_id, state_type)
```

- `activity_id` NOT NULL après migration Phase 2 (nullable temporaire Phase 1 avec default activity).
- Pending Commerce et pending Production **coexistent**.

**Chat messages :**

| Option | Décision |
|--------|----------|
| Historique global tenant | **Non** comme défaut — mélange les contextes Ashy |
| Historique par activité | **Oui** — `chat_messages.activity_id` NOT NULL (nullable Phase 1) |
| `session_id` / `sessionId` | Conserver pour threads UI ; clé RAM `userId:activityId:sessionId` |

**RAM conversation store :** clé actuelle `userId:sessionId` → cible `userId:activityId:sessionId`.

**pendingWrite / draft :** scopés par `(client_id, activity_id)` en DB ; état RAM aligné.

**Historique « général » tenant :** si besoin futur, vue read-only agrégée **sans** mélanger les pending writes.

---

### 6. Write operations / idempotency

**État B2-B :** `UNIQUE(client_id, operation_id)` — **validé, ne pas modifier dans B2-C.**

**Décision cible (Option C retenue) :**

| Élément | Décision |
|---------|----------|
| Unicité | **`UNIQUE(client_id, operation_id)` conservée** — `operation_id` = UUID v4 par opération, collision inter-activités improbable |
| Colonne `activity_id` | **Ajouter nullable** sur `agent_write_operations` en phase multi-activité (migration additive) — contexte replay et audit |
| `request_hash` | Doit inclure `activity_id` dans la canonicalisation **une fois** multi-activité active |
| Extension future | Si besoin métier prouvé : `UNIQUE(client_id, activity_id, operation_id)` en migration séparée — **pas requis pour B2-C/D/E** |

**Compatibilité B2-C/D/E :**

- B2-C intègre idempotence au scope **tenant** actuel — **compatible**.
- Lors de l’introduction de `activity_id`, les lignes legacy ont `activity_id = default_activity_id` (backfill).
- Replay `ALREADY_COMPLETED` doit retourner `result_id` **dans le contexte activité** d’origine (vérif via colonne `activity_id` + `request_hash`).

**Ne pas refaire F4 :** B2-B schema reste ; extensions **additives** uniquement.

---

### 7. n8n coexistence

**Principe :** n8n continue à utiliser `clients.id` comme `recordId` pendant la migration.

**Stratégie :**

| Phase | Comportement |
|-------|--------------|
| **Actuel → Phase 2** | n8n écrit sans `activity_id` → backend/default activity assignée automatiquement |
| **Phase 2+** | Payloads n8n acceptent `activity_id` optionnel ; défaut = `activities.is_default` |
| **Cutover** | Workflows Ashy natifs prioritaires ; n8n limité aux flows non migrés |
| **Garde-fou** | RPC batch (`execute_batch_operations`) reçoit `p_activity_id` nullable ; rejet si activité ≠ tenant |

**Éviter mauvaise activité :** tant que n8n n’envoie pas `activity_id`, **une seule activité default active par tenant** — pas de multi-activité UI avant que n8n soit prêt ou isolé par workflow.

**Ne pas modifier n8n** dans les phases B2 ; planifier changement payload en **P1 multi-activité**.

---

### 8. Admin architecture

**Décision :** Le **Ash Ledger Control Center** est un **plan d’auth et d’API séparé** du plan utilisateur métier.

```
USER PATH                          ADMIN PATH
─────────                          ──────────
PocketBase auth                    Admin auth (dedicated)
     ↓                                  ↓
req.user.clientId                  req.admin (no client scope by default)
     ↓                                  ↓
/api/ashy/chat                     /api/admin/*
/api/me                            admin services (read models)
                                   ↓
                                   observability, audit, support ops
```

**Interdit :** `isAdmin: true` vérifié **uniquement** côté frontend.

**Fondations existantes réutilisables :**

- `agent_write_operations` — diagnostic opérations Ashy
- `auth-log` / structured logs — base audit
- `GET /api/supabase/status` + internal key — health pattern
- Edge functions (`dashboard-session`, `support-bridge`) — **pas** le Control Center

---

### 9. RBAC

**Rôles conceptuels (futurs) :**

| Rôle | Scope | Capacités |
|------|-------|-----------|
| **USER** | Tenant + activities autorisées | App métier, Ashy |
| **ADMIN** | Admin plane | Lecture tenants, diagnostics, support limité |
| **SUPER_ADMIN** | Système | Actions sensibles (suspend, billing override) |

**Vérification :** middleware `requireAdmin` / `requireSuperAdmin` sur namespace `/api/admin/*` — **indépendant** de `requireClientScope`.

**Séparation stricte :** un admin connecté en mode admin **n’utilise pas** automatiquement `req.user.clientId` pour accéder aux données métier — accès via **admin services** explicites (impersonation auditée si un jour nécessaire).

**Stockage rôles (futur, non implémenté) :** table `admin_users` ou claims JWT admin séparés — **pas** colonne `is_admin` sur PocketBase users exposée au client.

---

### 10. Audit / observability

**`admin_audit_log` (conceptuel) :**

| Événement | Exemple |
|-----------|---------|
| Admin login / logout | |
| Role change | |
| User suspend / reactivate | |
| Subscription modify | |
| Sensitive read | export données tenant |
| Ashy operation intervention | replay / cancel manuel |
| Impersonation start/end | si implémenté |

**Observabilité existante :**

| Source | Usage Control Center futur |
|--------|----------------------------|
| `agent_write_operations` | Ops Ashy confirmées, replay, conflits |
| Logs structurés agent-session | Erreurs pending, divergence RAM/DB |
| `auth-log` | Tentatives auth, identity mismatch |
| Health endpoints | État services |

**À ajouter plus tard :** métriques agrégées (usage Ashy/jour, taux erreur tool), table `usage_events` optionnelle — **P3**.

---

### 11. Billing / subscriptions

**Décision :**

- Abonnement **attaché au tenant** (`clients`), **pas** à une activité.
- Plusieurs activités **ne créent pas** plusieurs abonnements par défaut.
- `clients.date_inscription`, `clients.date_fin_abonnement` restent tenant-level.
- Table `subscriptions` (frontend, non versionnée) → **normalisation future** avec RLS tenant-scoped.

**Règle :** désactiver un tenant suspend **toutes** ses activités.

---

## Target Architecture

```
                    AUTH USER (PocketBase + Supabase Auth)
                              │
                              ▼
                    TENANT (clients)
                    ├── subscription / billing
                    ├── onboarding
                    │
              ┌─────┴─────┬─────────────┐
              ▼           ▼             ▼
         ACTIVITY A   ACTIVITY B   ACTIVITY C
         (commerce)  (service)    (production)
              │           │             │
              └─────┬─────┴─────────────┘
                    ▼
            BUSINESS DATA
         (client_id + activity_id)

                         Ashy (single agent)
                              │
              AuthenticatedContext
              ├── userId
              ├── clientId        ← requireClientScope
              ├── activeActivityId ← requireActivityScope
              └── permissions
                              │
                    Intent (activity-aware)
                              │
                    Tool registry (by activity.type)
                              │
                    Activity-scoped services
                              │
                    Supabase (RLS + service_role)

    ADMIN USER (separate auth plane)
              │
              ▼
    requireAdmin / requireSuperAdmin
              │
              ▼
    /api/admin/*  →  read models + audit log
              │
              ▼
    agent_write_operations | health | metrics
    (never implicit client scope)
```

---

## Table Scope Matrix

| Table | Niveau actuel | Niveau cible | activity_id ? | session_id ? | Justification |
|-------|---------------|--------------|---------------|--------------|---------------|
| `clients` | Tenant | Tenant | **Non** | Non | Racine organisation |
| `activities` | — (n/a) | Tenant child | N/A (est l’activité) | Non | Nouvelle entité |
| `ventes` | Tenant | Activity | **Oui** | Non | Données commerce isolées |
| `depenses` | Tenant | Activity | **Oui** | Non | Dépenses par activité |
| `produits` | Tenant | Activity | **Oui** | Non | Catalogue par activité |
| `stocks` | Tenant | Activity | **Oui** | Non | Stock par catalogue |
| `paiements_dettes` | Tenant | Activity | **Oui** | Non | Lié aux ventes |
| `synthese_mensuelle` | Tenant | Activity (+ rollup) | **Oui** | Non | KPI ; vue tenant agrégée optionnelle |
| `chat_messages` | Tenant | Activity + session | **Oui** | Oui (UI) | Historique Ashy par activité |
| `chat_message_counters` | Tenant | Activity | **Oui** | Non | Séquences par activité |
| `agent_sessions` | Tenant | Activity | **Oui** | Non | Pending/draft par activité |
| `agent_write_operations` | Tenant | Tenant + activity context | **Oui (nullable→NOT NULL)** | Non | Idempotence ; unicité `(client_id, operation_id)` |
| `subscriptions` | Tenant (partiel) | Tenant | **Non** | Non | Billing global |
| `admin_audit_log` | — | System | Non | Non | Futur |
| `clients.type_activite` | Legacy config | Deprecated | migré → `activities.type` | Non | Transition seulement |

---

## Migration Strategy

### Phase 1 — Create default activity (no user impact)

```
clients.type_activite + nom_activite + flags
        ↓
INSERT activities (one row per client, is_default=true)
```

- Backend continue à lire `client_id` seul.
- `activeActivityId` = default activity en interne (transparent).

### Phase 2 — Backfill activity_id on business data

```
UPDATE ventes, depenses, produits, stocks, paiements_dettes
SET activity_id = default_activity.id
WHERE client_id = … AND activity_id IS NULL
```

- Colonnes `activity_id` **nullable** d’abord, puis NOT NULL après backfill.

### Phase 3 — Backend activity-scoped reads/writes

- `requireActivityScope` sur services et RPCs.
- Ashy context avec `activeActivityId`.
- Sessions : nouvelle contrainte `(client_id, activity_id, state_type)`.

### Phase 4 — Deprecate legacy columns

- `clients.type_activite`, `nom_activite`, flags migrés → lecture fallback only.
- Documentation + monitoring ; suppression colonnes dans migration ultérieure.

### Phase 5 — Multi-activity UI + n8n payload update

- Activity switcher frontend.
- n8n `activity_id` dans batch/chat selon workflow.

---

## Compatibility Strategy

| Composant | Stratégie |
|-----------|-----------|
| **Utilisateurs existants** | Une default activity = comportement identique |
| **Données existantes** | Backfill `activity_id` = default |
| **Ashy actuel** | Fonctionne Phase 1-2 sans UI multi-activité |
| **n8n** | `recordId` inchangé ; `activity_id` optionnel plus tard |
| **F4-B1 RPCs** | `p_client_id` conservé ; ajout `p_activity_id` nullable en extension |
| **F4-B2-B** | Schema inchangé ; `activity_id` colonne additive future |
| **B2-C/D/E** | Proceed at tenant scope ; canonical hash documenté pour extension activity |
| **RLS dashboard** | Étendre `ash_owns_client` → `ash_owns_activity(activity_id)` quand prêt |
| **Tests** | Default activity fixture ; pas de breaking change immédiat |

---

## Security Model

1. **Tenant isolation :** `client_id` jamais fourni par le client IA ; dérivé auth.
2. **Activity isolation :** `activity_id` jamais trusted from model ; validé `(activity_id ∈ tenant)`.
3. **Service role :** double scope obligatoire sur toute requête backend.
4. **Admin :** plan séparé ; pas de elevation via `clientId` utilisateur.
5. **RLS :** reste filet de sécurité dashboard ; backend ne s’y repose pas seul.
6. **Idempotence :** `request_hash` inclut activity dans canonical form (post Phase 3).
7. **Logs :** pas de secrets ; opérations admin auditées.

---

## Consequences

### Positive

- Évolution propre vers multi-activité sans dupliquer les tenants.
- Ashy reste un agent unique, extensible par type d’activité.
- B2-C/D/E peuvent avancer sans refonte F4.
- Control Center a un chemin d’implémentation clair.

### Negative

- Complexité scope double sur tous les services.
- Migrations additive multi-phases à maintenir.
- n8n et Ashy natif doivent converger sur `activity_id`.
- Tests et fixtures plus riches (tenant + activity).

### Neutral

- Terme « client » reste dans le code SQL ; doc utilise « tenant ».

---

## Risks

| Risque | Sévérité | Mitigation |
|--------|----------|------------|
| Oublier `activity_id` dans un service | HIGH | Lint/review checklist ; tests cross-activity |
| n8n écrit dans default activity wrong | MEDIUM | Single default until n8n updated |
| Migration backfill incomplete | HIGH | Constraint NOT NULL seulement après verify |
| Admin conflit scope user | HIGH | Separate middleware + routes |
| Sur-architecture prématurée | MEDIUM | Phases strictes ; P3 Control Center différé |
| `UNIQUE(client_id, operation_id)` insuffisant | LOW | UUID v4 ; extension possible |

---

## Open Questions

1. **Multi-utilisateur par tenant** (comptable + gérant) — hors scope ; impact sur `auth_user_id` unique ?
2. **Historique chat unifié** — vue agrégée tenant souhaitée pour support ?
3. **KPI cross-activity** — rapport consolidé tenant dans Ashy (« bénéfice total ») ?
4. **Impersonation admin** — nécessaire pour support ? Si oui, audit strict.
5. **Stock partagé** entre activités — exception métier ou toujours activity-scoped ?
6. **PocketBase vs Supabase Auth** — convergence long terme pour admin auth ?

---

## Implementation Phases

| Phase | Contenu | Priorité | Bloque B2-C ? |
|-------|---------|----------|---------------|
| **ADR** | Ce document | **Now** | Non |
| **B2-C/D/E** | Idempotence RPC + Node replay | **Now** | — |
| **P1a** | Table `activities` + default backfill | Before new activity types | Non |
| **P1b** | `activity_id` on business tables + sessions | Before new activity types | Non |
| **P1c** | `requireActivityScope` + Ashy context | Before new activity types | Non |
| **P2** | Activity switcher UI, tool registry by type | After P1 | Non |
| **P2** | n8n `activity_id` payloads | Before Production/Services cutover | Non |
| **P3** | Admin RBAC + `/api/admin/*` + audit log | Control Center | Non |
| **P3** | Control Center UI | Future | Non |

---

## Decision Summary

| # | Décision | Résumé |
|---|----------|--------|
| 1 | Tenant | `clients` = tenant ; pas d’activité = client séparé |
| 2 | Activities | Nouvelle entité `activities` 1:N ; legacy columns deprecated |
| 3 | Data | Double scope `client_id` + `activity_id` sur métier |
| 4 | Scope API | Backend détermine scope ; IA/frontend ne bypassent pas |
| 5 | Active activity | `activeActivityId` validé serveur dans contexte Ashy |
| 6 | Ashy | Agent unique, routage activity-aware |
| 7 | Sessions | `UNIQUE(client_id, activity_id, state_type)` ; chat par activité |
| 8 | Idempotence | Garder `UNIQUE(client_id, operation_id)` ; ajouter `activity_id` nullable plus tard |
| 9 | n8n | Coexistence ; default activity ; payload extension P1 |
| 10 | Admin | Plan auth/API séparé Control Center |
| 11 | RBAC | USER / ADMIN / SUPER_ADMIN — backend enforced |
| 12 | Audit | `admin_audit_log` futur |
| 13 | Billing | Tenant-level only |
| 14 | B2-C | **GO** — continuer au scope tenant actuel |

---

*Références : audit architecture 2026-09-09, F4-B1/B2-B reports, `docs/architecture/authentication-and-data-isolation.md`, `docs/architecture/backend-migration-audit.md`.*
