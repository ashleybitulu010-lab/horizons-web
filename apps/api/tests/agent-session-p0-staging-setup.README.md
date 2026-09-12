# Phase 5.8-P0-STAGING-SETUP — Environnement Supabase staging

Guide pour créer et configurer un projet Supabase **staging** séparé de la production Ash Ledger.

## Production (interdit pour les tests P0)

| Environnement | Project ref | URL |
|---------------|-------------|-----|
| **PRODUCTION** | `knrwplidgvuvjnuqqmrt` | `https://knrwplidgvuvjnuqqmrt.supabase.co` |

Ne jamais sur production :

- appliquer la migration P0 ;
- exécuter le harness P0 ;
- créer des utilisateurs de test ;
- supprimer ou modifier des données.

## 1. Créer le projet staging (dashboard Supabase)

Supabase CLI et Docker ne sont pas requis. Création manuelle :

1. Ouvrir [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. **New project**
3. Nom recommandé : `Ash Ledger Staging`
4. Région : même région que production si possible (latence)
5. Mot de passe base de données : choisir un mot de passe fort (ne pas le committer)
6. Attendre la fin du provisioning

**Ne pas** sélectionner ni modifier le projet `knrwplidgvuvjnuqqmrt`.

## 2. Récupérer les informations (non secrètes)

Dashboard → **Project Settings → General** :

- **Reference ID** → `{STAGING_PROJECT_REF}`
- **Project URL** → `https://{STAGING_PROJECT_REF}.supabase.co`

Dashboard → **Project Settings → API** :

- **service_role** key → copier dans `.env.staging` local uniquement (jamais dans le repo)

## 3. Configurer le fichier local staging

```bash
cd apps/web/apps/api
cp .env.staging.example .env.staging
# Éditer .env.staging avec les vraies valeurs staging (fichier gitignored)
```

Contenu attendu :

```env
SUPABASE_URL=https://{STAGING_PROJECT_REF}.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<STAGING_SERVICE_ROLE_KEY>
RUN_STAGING=true
STAGING_ALLOWED_SUPABASE_PROJECT_REF={STAGING_PROJECT_REF}
NODE_ENV=development
```

Le fichier `.env` de production / développement local **reste inchangé**.

## 4. Schéma staging avant migration

Un nouveau projet Supabase **ne contient pas** :

- la table `agent_sessions` (schéma métier Ash Ledger) ;
- la colonne `state_version` ;
- les RPC `mirror_agent_sessions_atomic` ;
- les RPC `consume_agent_pending`.

Le harness P0 échouera sur les prérequis tant que le schéma de base et la migration P0 ne sont pas appliqués.

**Ne pas copier** les données production (ventes, dépenses, stock, clients, utilisateurs).

Le harness crée ses propres données de test éphémères.

## 5. Appliquer la migration P0 (STAGING uniquement)

**Ne pas exécuter** sur `knrwplidgvuvjnuqqmrt`.

Fichier : `supabase/migrations/20260905120000_agent_sessions_p0_atomic_ops.sql`

### Option A — SQL Editor (sans CLI)

1. Dashboard staging → **SQL Editor**
2. Appliquer d’abord les migrations Ash Ledger antérieures si `agent_sessions` n’existe pas encore
3. Coller le contenu de la migration P0
4. Exécuter
5. Vérifier : colonne `state_version` et RPC présents

### Option B — Supabase CLI (si installé plus tard)

```bash
supabase login
supabase link --project-ref {STAGING_PROJECT_REF}
supabase db push
```

Lier **uniquement** le projet staging, jamais `knrwplidgvuvjnuqqmrt`.

### Option C — psql

Utiliser la connection string du dashboard staging (Settings → Database).

## 6. Lancer le harness P0 staging

```bash
cd apps/web/apps/api
node --env-file=.env.staging --test tests/agent-session-p0-staging.test.js
```

Garde-fous actifs :

- `RUN_STAGING=true` requis
- `STAGING_ALLOWED_SUPABASE_PROJECT_REF` doit correspondre à l’URL
- `NODE_ENV=production` → bloqué
- ref production `knrwplidgvuvjnuqqmrt` → **toujours bloqué**

## 7. Séparation production / staging

| Fichier / système | Rôle |
|-------------------|------|
| `.env` | Dev local / prod VPS (inchangé par ce setup) |
| `.env.staging` | Harness P0 uniquement (gitignored) |
| `.env.example` | Template dev, `RUN_STAGING=false` |
| `.env.staging.example` | Template staging sans secrets |
| `.github/workflows/deploy.yml` | Production VPS (inchangé) |
| `docker-compose.yml` | Production (inchangé) |
| `src/config/env.js` | Default URL production pour l’app (inchangé) |

## 8. Tests unitaires du garde-fou (sans Supabase)

```bash
node --test tests/agent-session-p0-staging-guard.test.js
```
