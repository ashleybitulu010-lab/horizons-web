# Ashy — Deuxième tool métier : get_expenses

Phase 3.1 ajoute `get_expenses` comme deuxième tool read réel d’Ashy, sur le même modèle architectural que `get_sales`.

## Objectif

Permettre à Ashy de lire les dépenses authentifiées depuis Supabase, sans inventer de montants, sans accepter d’identité fournie par le message, et sans utiliser la mémoire conversationnelle comme source de vérité.

## Source Supabase

**Table :** `public.depenses`

Colonnes utilisées par le service (confirmées dans le projet via migrations, batch RPC, n8n et frontend) :

| Colonne | Usage |
|---------|--------|
| `id` | Identifiant interne (non exposé inutilement dans la réponse Ashy) |
| `client_id` | Scope tenant — filtré via `req.user.clientId` |
| `libelle_depense` | Libellé de la dépense |
| `type_depense` | Catégorie |
| `montant_depense` | Montant |
| `date` | Date métier (filtre principal) |
| `created_at` | Fallback date si nécessaire |

**Note :** le DDL complet de `public.depenses` n’est pas versionné dans le dépôt ; la structure ci-dessus est inférée des chemins d’écriture/lecture existants (notamment `20260814143000_batch_operations_rpc.sql`).

## Input du tool

```json
{
  "period": "current_month",
  "startDate": null,
  "endDate": null,
  "category": null,
  "limit": 500,
  "order": "date_desc"
}
```

Même logique de périodes que `get_sales` via `utils/periods.js` :
- `current_month`, `previous_month`, `today`, `current_week`, etc.
- ou plage explicite `startDate` / `endDate` (YYYY-MM-DD)

**Interdit dans l’input :** `userId`, `clientId`, `businessUserId`, `tenantId`, etc.

## Contexte utilisateur

Le tool reçoit le contexte backend :

```javascript
createToolExecutionContext({ user: req.user })
```

Le service appelle `requireClientScope(user)` puis filtre `.eq('client_id', clientId)`.

## Service

Fichier : `apps/api/src/services/expenses-service.js`

```
Ashy → get_expenses → ExpenseService → Supabase public.depenses
```

Fonctions :
- `fetchExpensesForUser(user, input, referenceDate)`
- `summarizeExpenses(rows)` → `{ count, totalAmount, byCategory[] }`
- `getExpenses(user, input, referenceDate)`

Hook tests : `setExpensesQueryImplForTests()`

## ToolResult

Succès :

```json
{
  "success": true,
  "tool": "get_expenses",
  "data": {
    "summary": { "count": 2, "totalAmount": 45, "byCategory": [] },
    "expenses": [
      { "label": "Transport", "category": "Transport", "amount": 20, "date": "..." }
    ]
  },
  "meta": { "period": "current_month", "startDate": "...", "endDate": "...", "count": 2 },
  "error": null
}
```

Erreur Supabase → `success: false`, `data: null`, jamais de montant inventé.

## Intégration registry

`tools/definitions.js` : `implemented: true`, `access: read`, `sourceOfTruth: supabase`

`tools/registry.js` : exécuteur `runGetExpenses`

## Intégration planner

Intents supportés :

| Intent | Plan |
|--------|------|
| `query_expenses` | 1 step `get_expenses` + `referenceUpdate` |
| `compare_expenses` | 2 steps `get_expenses` (périodes conversationnelles) |

Exemples utilisateur :
- « Combien ai-je dépensé ce mois-ci ? » → `query_expenses` / `current_month`
- « Et le mois dernier ? » (topic expenses) → `query_expenses` / `previous_month`
- « Compare les deux. » (topic expenses) → `compare_expenses`

## Intent resolver

`regex-resolver.js` :
- patterns dépenses (mois en cours, générique, follow-up)
- compare/previous month sensibles au `topic` (`expenses` vs `sales`)
- changement de domaine : « Combien ai-je vendu ? » après une question dépenses → `get_sales`

## Mémoire conversationnelle

Stocke uniquement :
- `topic: expenses`
- `references.lastPeriod`, `previousPeriod`
- pas de montants ni totaux

Chaque réponse relit Supabase via le tool.

## Sécurité et isolation

- Scope `client_id` obligatoire côté service
- Rejet des paramètres d’identité arbitraires (`tools/validation.js`)
- Tests : user A ≠ user B, Supabase error, données vides

## Erreurs

| Code | Cas |
|------|-----|
| `CLIENT_SCOPE_MISSING` | Pas de `clientId` authentifié |
| `FORBIDDEN_PARAMETER` | Identité dans l’input |
| `INVALID_PERIOD` | Période inconnue |
| `SUPABASE_ERROR` | Échec requête Supabase |
| `UNAUTHENTICATED` | Pas de user context |

## Même modèle que get_sales

| Couche | Ventes | Dépenses |
|--------|--------|----------|
| Service | `sales-service.js` | `expenses-service.js` |
| Tool | `get-sales.js` | `get-expenses.js` |
| Table | `public.ventes` | `public.depenses` |
| Périodes | `utils/periods.js` | `utils/periods.js` |
| Contrat | ToolResult | ToolResult |
| Isolation | `requireClientScope` | `requireClientScope` |

## n8n

Non migré en Phase 3.1. Le workflow n8n dépenses reste actif en parallèle via `POST /chat`.

## Prochaine étape recommandée

Phase 3.2 : `get_stock` ou resolver LLM — uniquement après validation de cette phase.
