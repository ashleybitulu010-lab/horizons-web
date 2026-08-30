# Ash Ledger API (`apps/api`)

Backend Express d'Ash Ledger — socle pour la migration progressive depuis n8n.

## Démarrage

```bash
cp .env.example .env
# Renseigner les variables (ne jamais committer .env)
npm install
npm run dev
```

En monorepo : `npm run dev` à la racine lance web + api + pocketbase.

## Routes

| Méthode | Chemin | Description |
|---------|--------|-------------|
| GET | `/health` | Ping legacy (inchangé) |
| GET | `/api/health` | Santé structurée du backend |
| GET | `/api/supabase/status` | Test connectivité Supabase (protégé) |
| POST | `/chat` | Proxy n8n (inchangé) |

Le frontend appelle l'API via le préfixe déployé `/hcgi/api` (ex. `/hcgi/api/chat`).

## Variables d'environnement

Voir `.env.example`.

- **`SUPABASE_SERVICE_ROLE_KEY`** — serveur uniquement, jamais côté navigateur
- **`ASH_INTERNAL_HEALTH_KEY`** — header `x-ash-internal-key` pour `/api/supabase/status`

## Architecture interne

```
src/
├── config/       # env + métadonnées app
├── supabase/     # client admin + ping
├── agent/        # stub orchestrateur Ashy
├── tools/        # registre d'outils métier (stubs)
├── services/     # règles métier (futur)
├── routes/       # Express routes
└── middleware/
```

Documentation complète : `docs/architecture/ashy-backend-architecture.md` (dans apps/web).

## Contrat Ashy ↔ Supabase

Supabase = vérité métier. Ashy = orchestration. Le backend = sécurité et accès contrôlé.
Voir `src/agent/contract.js` et la documentation architecture.

## Tests

```bash
npm test
npm run lint
```

Les tests n'exigent pas PocketBase ni n8n pour les routes `/api/*`.

## Déploiement Docker (production)

Remplace le conteneur legacy `/docker/ash-ledger-api/api` par ce package.

```bash
cd apps/api
cp docker-compose.env.example .env   # puis renseigner les secrets (jamais committer)
docker compose build
docker compose up -d
```

- **Port conteneur** : `3000` (nginx VPS proxy vers `127.0.0.1:3001`)
- **Routes** : montées sous `/hcgi/api/*` (compatible frontend + nginx actuel)
- **Rollback** : retaguer l'image legacy et `docker compose up -d --force-recreate`

Voir `docker-compose.yml` et `docker-compose.env.example` pour la liste complète des variables.
