# Ashy Phase 3.8 — create_sale

Phase 3.8 ajoute le **premier tool write** d’Ashy : **`create_sale`**, avec gate stock atomique côté Supabase.

## Périmètre

- Backend `apps/api` uniquement
- Frontend et n8n **inchangés** (les écritures UI passent encore par n8n)
- Confirmation utilisateur obligatoire avant mutation

## Source Supabase

**RPC :** `public.create_sale_atomic(p_client_id, p_product, p_quantity, p_unit_price, p_amount_paid)`

Migration : `supabase/migrations/20260830120000_create_sale_atomic.sql`

| Étape | Action |
|-------|--------|
| 1 | Résolution produit (`resolve_produit_id`) |
| 2 | **Stock gate** : `(entrees - sorties) >= quantite` |
| 3 | INSERT `public.ventes` |
| 4 | UPDATE `public.stocks.sorties` + `vente_ids` |

Tout se fait dans **une transaction** ; refus si stock insuffisant (aucune vente créée).

## Contrat input

```json
{
  "product": "Poulet",
  "quantity": 2,
  "unitPrice": 10,
  "amountPaid": 20,
  "confirmed": false
}
```

Alias français acceptés : `produit`, `quantite`, `prix_unitaire`, `montant_paye`.

Identité interdite (`clientId`, `userId`, etc.) — scope via JWT PocketBase → `requireClientScope(user)`.

| Champ | Règle |
|-------|-------|
| `product` | Requis |
| `quantity` | > 0 |
| `unitPrice` | > 0 ; fallback catalogue `produits.prix_vente_unitaire` si absent |
| `amountPaid` | ≥ 0 (0 = vente à crédit) |
| `confirmed` | `false` → preview ; `true` → exécution RPC |

## Chaîne d’exécution

```
Message « J'ai vendu … »
  → regex resolver (create_sale, confirmed: false)
  → tool planner → create_sale
  → sales-write-service (preview ou RPC)
  → NEEDS_CONFIRMATION → pendingWrite en session

Message « oui »
  → regex resolver (confirmed: true depuis pendingWrite)
  → create_sale → create_sale_atomic
  → succès + alerte stock bas / épuisé
```

## Intents supportés

| Message type | Comportement |
|--------------|--------------|
| « J'ai vendu 2 poulets à 10 $, payé 20 $ » | Preview + demande confirmation |
| « oui » (après preview) | Exécution atomique |
| « J'ai vendu 2 poulets à 10 $ » | Clarification montant encaissé |
| Stock insuffisant | Refus sans écriture |

## ToolResult

**Preview (non confirmé) :**

```json
{
  "success": false,
  "tool": "create_sale",
  "error": { "code": "NEEDS_CONFIRMATION" },
  "meta": {
    "requiresConfirmation": true,
    "preview": {
      "product": "Poulet",
      "quantity": 2,
      "unitPrice": 10,
      "amountPaid": 20,
      "total": 20
    }
  }
}
```

**Succès :**

```json
{
  "success": true,
  "tool": "create_sale",
  "data": {
    "summary": {
      "saleId": "uuid",
      "product": "Poulet",
      "quantity": 2,
      "unitPrice": 10,
      "amountPaid": 20,
      "total": 20,
      "stockRemaining": 8,
      "stockAlert": null
    }
  }
}
```

## Isolation

- `p_client_id` injecté côté serveur depuis le profil utilisateur
- Aucun paramètre d’identité dans l’input tool
- `pendingWrite` stocké en session serveur, **non exposé** au client

## Tests

- `apps/api/tests/create-sale.test.js` — contrat tool + mock `setCreateSaleImplForTests`
- `apps/api/tests/tool-planner.test.js` — plan `create_sale`
- `apps/api/tests/ashy-orchestrator.test.js` — flux confirmation bout en bout

## Prochaine phase

Phase 3.9 : routage frontend des écritures vers Ashy (flag dédié, fallback n8n).
