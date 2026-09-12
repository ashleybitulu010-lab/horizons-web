# P0 Staging Harness — Guide de validation Supabase réelle

Ce harness (`agent-session-p0-staging.test.js`) exécute des tests **réels** contre PostgreSQL/Supabase.
Il ne doit **jamais** être lancé accidentellement contre la production.

**Setup staging** : voir `agent-session-p0-staging-setup.README.md` et `.env.staging.example`.

**Production interdite** : `knrwplidgvuvjnuqqmrt` — bloquée explicitement par le garde-fou.

## 1. Identifier le project ref

Depuis l'URL Supabase :

```text
https://{PROJECT_REF}.supabase.co
```

Exemple : `https://my-staging.supabase.co` → `PROJECT_REF = my-staging`

Dans le dashboard Supabase : **Project Settings → General → Reference ID**.

## 2. Variables requises (`.env.staging` local, jamais commité)

Copier `.env.staging.example` → `.env.staging` :

```env
SUPABASE_URL=https://{STAGING_PROJECT_REF}.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<STAGING_SERVICE_ROLE_KEY>
RUN_STAGING=true
STAGING_ALLOWED_SUPABASE_PROJECT_REF={STAGING_PROJECT_REF}
NODE_ENV=development
```

Règles :

- `RUN_STAGING` doit être **exactement** `true` (pas `1`, pas absent).
- `STAGING_ALLOWED_SUPABASE_PROJECT_REF` doit **correspondre exactement** au ref extrait de `SUPABASE_URL`.
- `NODE_ENV=production` **bloque** le harness.
- Le ref production `knrwplidgvuvjnuqqmrt` est **toujours bloqué**.

## 3. Lancer le harness

```bash
cd apps/web/apps/api
node --env-file=.env.staging --test tests/agent-session-p0-staging.test.js
```

## 4. Reconnaître un SKIP

Le harness affiche un message du type :

```text
P0 staging harness blocked: RUN_STAGING_NOT_TRUE ({"supabaseUrl":"PRESENT",...})
```

Toutes les suites `Phase 5.8-P0-STAGING — …` sont **skipped** si une condition de sécurité n'est pas remplie.

C'est le comportement **attendu** tant que l'environnement staging n'est pas configuré explicitement.

## 5. Reconnaître un vrai PASS

- Aucun skip sur les suites P0-STAGING (prerequisites, P0-1, P0-2, …).
- Tests `PASS` avec connexion Supabase réelle.
- Migration P0 appliquée au préalable sur le projet staging.

## 6. Éviter la production

1. Utiliser un **projet Supabase staging dédié** (voir setup README).
2. Le ref `knrwplidgvuvjnuqqmrt` est **bloqué** par le harness même si `RUN_STAGING=true`.
3. Garder `RUN_STAGING=false` par défaut dans `.env.example`.
4. Ne jamais committer `.env.staging` ni la service role key.

## 7. Tests unitaires du garde-fou (sans Supabase)

```bash
node --test tests/agent-session-p0-staging-guard.test.js
```
