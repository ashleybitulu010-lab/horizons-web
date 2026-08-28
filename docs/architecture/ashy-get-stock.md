# Ashy Phase 3.2 — get_stock

Phase 3.2 ajoute le troisième tool read métier d’Ashy : **`get_stock`**.

## Source Supabase

**Table principale :** `public.stocks`

| Colonne | Usage |
|---------|--------|
| `numero` | Identifiant de ligne stock |
| `client_id` | Scope tenant |
| `produit_id` | Lien vers `public.produits` |
| `nom_article` | Libellé article |
| `stock_initial` | Stock initial |
| `entrees` | Entrées cumulées |
| `sorties` | Sorties cumulées |
| `stock_actuel` | Quantité générée : `stock_initial + entrees - sorties` |
| `seuil_alerte` | Seuil bas stock (fallback applicatif : 5) |
| `created_at` | Tri des lignes |

**Table enrichissement :** `public.produits` (`id`, `client_id`, `nom_produit`, `categorie`)

Le DDL complet n’est pas versionné dans le dépôt ; la structure est inférée des migrations et du code existant (batch RPC, dashboard, n8n).

## Contrat input

```json
{
  "product": "Cahiers",
  "lowStockOnly": false,
  "limit": 500
}
```

Pas de période : le stock est un **état courant**, pas une série temporelle.

Identité interdite dans l’input (`clientId`, `userId`, etc.).

## Chaîne d’exécution

```
Message → regex resolver → tool planner → get_stock
  → stock-service → Supabase (stocks + produits)
  → ToolResult → response formatter
```

## Intents supportés

| Message type | Intent | Filtres |
|--------------|--------|---------|
| « Quel est mon stock ? » | `query_stock` | — |
| « Combien me reste-t-il de cahiers ? » | `query_stock` | `product` |
| « Quels produits sont presque épuisés ? » | `query_stock` | `lowStockOnly: true` |
| « Et mon stock ? » (après dépenses) | `query_stock` | — |

Changement de domaine : « Combien ai-je vendu ? » après une question stock → `get_sales`.

## ToolResult

```json
{
  "success": true,
  "tool": "get_stock",
  "data": {
    "summary": {
      "count": 2,
      "totalQuantity": 17,
      "lowStockCount": 1,
      "outOfStockCount": 0,
      "items": []
    },
    "items": []
  },
  "meta": { "product": null, "lowStockOnly": false, "count": 2 },
  "error": null
}
```

## Isolation

- `requireClientScope(user)` → `.eq('client_id', clientId)` sur `stocks` et `produits`
- Tests user A / user B
- Rejet paramètres d’identité arbitraires

## Mémoire conversationnelle

Stocke `topic: stock`, `lastEntity: stock`, `lastProduct` si filtre produit.

Ne stocke **jamais** les quantités comme vérité : chaque question relit Supabase.

## Seuil bas stock

- Utilise `seuil_alerte` de la ligne si > 0
- Sinon fallback **5** (aligné n8n `DEFAULT_SEUIL`)
- Pas de règle inventée au-delà de ce qui existe déjà dans le projet

## n8n

Non migré. `POST /chat` reste actif en parallèle.

## Même modèle que get_sales / get_expenses

| Couche | Fichier |
|--------|---------|
| Service | `stock-service.js` |
| Tool | `get-stock.js` |
| Registry | `registry.js` |
| Planner | `tool-planner.js` |
| Resolver | `regex-resolver.js` |
| Formatter | `response-formatter.js` |

## Prochaine étape (hors Phase 3.2)

- `get_debts` ou intent resolver LLM — uniquement après validation explicite
