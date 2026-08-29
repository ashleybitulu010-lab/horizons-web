# Ashy Phase 3.6 — generate_report

Phase 3.6 ajoute `generate_report` comme sixième tool read réel d’Ashy, sur le même modèle que les phases 3.1 → 3.5.

## Objectif

Permettre à Ashy de produire une **synthèse texte read-only** de l’activité authentifiée (ventes, dépenses, bénéfice estimé, dettes impayées, stock), sans PDF, sans écriture, et sans accepter d’identité fournie par le message.

## Type de rapport V1

Un seul type : `activity_summary`.

## Sources de données

Composition interne via les services existants :

| Service | Données | Période |
|---------|---------|---------|
| `sales-service` | CA, encaissements, count ventes | Oui |
| `expenses-service` | total dépenses, count | Oui |
| `debts-service` | dettes impayées (`status: unpaid`) | Snapshot hors période |
| `stock-service` | articles, stock faible, ruptures | Snapshot hors période |

**Exclus V1 :** `get_products`, vue `synthese_mensuelle`, PDF, écriture Supabase.

## Bénéfice estimé

```
estimatedProfit = totalCollected - totalExpenses
```

Aligné sur le dashboard live (encaissements − dépenses).

## Input du tool

```json
{
  "period": "current_month",
  "startDate": null,
  "endDate": null
}
```

| Paramètre | Description |
|-----------|-------------|
| `period` | Un des `PERIOD_IDS` (`today`, `yesterday`, `current_week`, `previous_week`, `current_month`, `previous_month`, `current_year`) |
| `startDate` / `endDate` | Plage absolue YYYY-MM-DD (alternative à `period`) |

Défaut : `current_month` si absent.

**Interdit :** `userId`, `clientId`, `businessUserId`, etc.

## Output ToolResult

```json
{
  "success": true,
  "tool": "generate_report",
  "data": {
    "summary": {
      "reportType": "activity_summary",
      "salesCount": 12,
      "totalRevenue": 1500,
      "totalCollected": 1200,
      "expenseCount": 5,
      "totalExpenses": 400,
      "estimatedProfit": 800,
      "unpaidDebtTotal": 300,
      "unpaidDebtCount": 2,
      "stockItemCount": 8,
      "lowStockCount": 1,
      "outOfStockCount": 0
    },
    "sections": {
      "sales": {},
      "expenses": {},
      "debts": {},
      "stock": {}
    }
  },
  "meta": {
    "period": "current_month",
    "startDate": "2026-08-01",
    "endDate": "2026-08-31",
    "reportType": "activity_summary",
    "timeZone": "Africa/Kinshasa"
  }
}
```

## Intent resolver

- Intent : `generate_report`
- Topic : `report`
- Filtres : `period` (héritage contexte conversationnel)

### Formulations reconnues

| Exemple | Intent |
|---------|--------|
| « Je peux avoir mon bilan » | `generate_report` |
| « Quel est mon bénéfice ? » | `generate_report` |
| « Fais-moi un récapitulatif » | `generate_report` |
| « Combien ai-je vendu ce mois-ci ? » | `query_sales` |
| « Compare ventes et dépenses » | `compare_sales_expenses` |
| « Envoie mon bilan PDF » | clarification (pas de tool) |

## Planner

```
intent generate_report → generate_report({ period })
```

Un seul step — agrégation interne dans `report-service.js`.

## Chaîne d’exécution

```
Message → intent resolver → tool planner → generate_report
  → report-service → services sales/expenses/debts/stock
  → Supabase (lectures live)
  → ToolResult → response formatter
```

## Sécurité

- `requireClientScope(user)` sur toutes les lectures
- Identité backend uniquement
- Fail-fast si une source échoue (pas de chiffres partiels inventés)
- Mémoire conversationnelle : contexte seulement (période, topic)

## Limites Phase 3.6

- Texte uniquement — pas de PDF
- Type unique `activity_summary`
- Pas de catalogue produits dans le rapport
- n8n `/chat` reste actif en parallèle
- Frontend non modifié
- Pas de migration `/chat` → `/api/ashy/chat`

## Compatibilité n8n

| Demande | n8n | Backend Ashy V1 |
|---------|-----|-----------------|
| Bilan texte | `recherche` | `generate_report` |
| Bilan PDF | `synthese_pdf` | clarification explicite |

n8n reste inchangé.
