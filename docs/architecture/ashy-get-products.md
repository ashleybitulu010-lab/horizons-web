# Ashy Phase 3.5 — get_products

Phase 3.5 ajoute `get_products` comme cinquième tool read réel d’Ashy, sur le même modèle que `get_sales`, `get_expenses`, `get_stock` et `get_debts`.

## Objectif

Permettre à Ashy de lire le **catalogue produits** authentifié depuis Supabase (noms, catégories, prix achat/vente), sans quantités de stock, sans écriture, et sans accepter d’identité fournie par le message.

## Source Supabase

**Table principale :** `public.produits`

Le DDL complet n’est pas versionné dans le dépôt ; la structure est inférée des migrations et du code existant (batch RPC, triggers, dashboard, n8n).

| Colonne | Usage |
|---------|--------|
| `id` | Identifiant UUID produit |
| `client_id` | Scope tenant — filtré via `req.user.clientId` |
| `nom_produit` | Nom du produit |
| `categorie` | Catégorie optionnelle |
| `prix_achat_unitaire` | Prix d’achat catalogue |
| `prix_vente_unitaire` | Prix de vente catalogue |
| `created_at` | Tri chronologique |

**Pas de colonne `actif` / `status` / `sku`** dans le schéma confirmé — aucun filtre actif/inactif.

## Input du tool

```json
{
  "product": "Savon",
  "category": "Hygiène",
  "limit": 500,
  "order": "name_asc"
}
```

| Paramètre | Description |
|-----------|-------------|
| `product` | Recherche partielle sur `nom_produit` |
| `category` | Recherche partielle sur `categorie` |
| `limit` | Max lignes (défaut 500, borné 1–1000) |
| `order` | `name_asc`, `name_desc`, `created_desc`, `created_asc` |

Pas de période : le catalogue est un **état courant**.

**Interdit :** `userId`, `clientId`, `businessUserId`, etc.

## Distinction products vs stock

| Formulation | Tool |
|-------------|------|
| « Quels sont mes produits ? », « Liste mes produits », « Quels produits je vends ? » | `get_products` |
| « Quel est mon stock ? », « Combien me reste-t-il de savon ? », « Quels produits sont presque épuisés ? » | `get_stock` |
| « Quel produit se vend le mieux ? » | `best_product` → `get_sales` |

`get_products` retourne le **catalogue** (fiches produits).  
`get_stock` retourne les **quantités** (table `stocks`).

Un produit peut exister dans le catalogue sans ligne stock, et inversement une ligne stock peut exister sans fiche catalogue complète.

## Intent resolver

- Intent : `query_products`
- Topic : `products`
- Filtres : `product`, `category`
- Regex : patterns catalogue avant ventes/dépenses génériques, après patterns stock
- LLM : topic `products` ajouté au contrat Phase 3.5

## Planner

```
intent query_products → get_products
```

## Orchestrateur

Exécute `get_products`, met à jour le contexte (`topic: products`, `lastEntity: products`), formate via `formatProductsQueryReply`.

## Isolation

Même règles que les autres tools : identité backend uniquement, tests user A / user B, rejet des paramètres d’identité interdits.

## Limites Phase 3.5

- Lecture seule (pas de `create_product` / modification catalogue)
- Pas de quantités stock dans la réponse
- n8n `/chat` reste actif en parallèle
- Frontend non modifié

## Chaîne d’exécution

```
Message → intent resolver → tool planner → get_products
  → products-service → Supabase public.produits
  → ToolResult → response formatter
```

## ToolResult

```json
{
  "success": true,
  "tool": "get_products",
  "data": {
    "summary": { "count": 2, "categoryCount": 2 },
    "products": [
      {
        "id": "uuid",
        "name": "Savon",
        "category": "Hygiène",
        "purchasePrice": 500,
        "salePrice": 800
      }
    ]
  },
  "meta": { "product": null, "category": null, "order": "name_asc", "count": 2 },
  "error": null
}
```
