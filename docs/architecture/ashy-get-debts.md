# Ashy — Troisième tool métier read : get_debts

Phase 3.4 ajoute `get_debts` comme quatrième tool read réel d’Ashy, sur le même modèle que `get_sales`, `get_expenses` et `get_stock`.

## Objectif

Permettre à Ashy de lire les dettes clients authentifiées depuis Supabase, sans inventer de montants, sans accepter d’identité fournie par le message, et sans utiliser la mémoire conversationnelle comme source de vérité.

## Source Supabase

**Pas de table `dettes` dédiée.** Les dettes clients sont modélisées via :

| Source | Usage |
|--------|--------|
| `public.ventes` | Dettes impayées via `reste_a_payer > 0` |
| `public.paiements_dettes` | Registre de suivi (montant = reste à payer, 0 quand soldé) |

Colonnes `ventes` utilisées (alignées sur `sales-service.js`) :

| Colonne | Usage |
|---------|--------|
| `id` | Identifiant vente / ligne de dette |
| `client_id` | Scope tenant — filtré via `req.user.clientId` |
| `libelle` | Libellé vente / client |
| `montant_paye` | Montant déjà encaissé |
| `total_brut` | Montant total de la vente |
| `reste_a_payer` | **Solde impayé (source principale)** |
| `date` | Date de la vente |
| `statut` | Statut métier (Payé, Partiel, Impayé, …) |

## Input du tool

```json
{
  "period": null,
  "startDate": null,
  "endDate": null,
  "status": "unpaid",
  "debtor": null,
  "limit": 500,
  "order": "date_desc"
}
```

- `status` : `unpaid` (défaut), `settled`, `all`
- `period` / plage date : optionnels — sans période, toutes les dettes correspondant au statut sont retournées
- **Interdit :** `userId`, `clientId`, `businessUserId`, etc.

## Contexte utilisateur

```javascript
createToolExecutionContext({ user: req.user })
```

Le service appelle `requireClientScope(user)` puis filtre `.eq('client_id', clientId)`.

## Service

Fichier : `apps/api/src/services/debts-service.js`

```
Ashy → get_debts → DebtsService → Supabase public.ventes
```

Fonctions :
- `fetchDebtsForUser(user, input, referenceDate)`
- `summarizeDebts(rows, status)` → `{ count, unpaidCount, totalRemaining, debtorCount, byDebtor[] }`
- `getDebts(user, input, referenceDate)`

Hook tests : `setDebtsQueryImplForTests()`

## ToolResult

Succès :

```json
{
  "success": true,
  "tool": "get_debts",
  "data": {
    "summary": { "count": 2, "unpaidCount": 2, "totalRemaining": 65, "debtorCount": 2 },
    "debts": [{ "id": "...", "label": "...", "remaining": 40, "paid": 10, "total": 50 }]
  },
  "meta": { "period": null, "status": "unpaid", "count": 2 },
  "error": null
}
```

## Intent resolver

- Intent : `query_debts`
- Topic : `debts`
- Filtres : `status`, `period`, `debtor`
- Regex : « Quelles sont mes dettes ? », « Combien me doivent-ils ? », « Et mes dettes ? », « encore impayées »
- LLM : topic `debts` ajouté au contrat Phase 3.3

## Planner

```
intent query_debts → get_debts
```

Le LLM ne choisit jamais le tool directement.

## Orchestrateur

Exécute `get_debts`, met à jour le contexte (`topic: debts`, `lastEntity: debts`), formate via `formatDebtsQueryReply`.

## Isolation

Même règles que les autres tools : identité backend uniquement, tests user A / user B, rejet des paramètres d’identité interdits.

## Limites Phase 3.4

- Lecture seule (pas de `create_debt` / encaissement)
- Pas de compare multi-domaine dettes+ventes (architecture future)
- n8n `/chat` reste actif en parallèle
- Frontend non modifié
