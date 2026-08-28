# Ash Ledger — Ashy Tools v1

> Phase 2 — premier tool réel (`get_sales`) + orchestration conversationnelle. n8n reste actif en parallèle.

## Architecture Ashy

```
Utilisateur authentifié
        ↓
POST /api/ashy/chat
        ↓
Orchestrateur Ashy (apps/api/src/agent/)
        ↓
Intent resolver + conversation state
        ↓
Tool get_sales
        ↓
Sales Service
        ↓
Scope client authentifié (req.user.clientId)
        ↓
Supabase public.ventes
        ↓
Résultat structuré
        ↓
Response formatter (réponse naturelle)
```

Route parallèle : `POST /chat` → n8n (inchangé).

## Schéma ventes utilisé

**Table :** `public.ventes` (seule table ventes identifiée — pas de conflit)

| Colonne | Rôle |
|---------|------|
| `id` | UUID vente |
| `client_id` | FK → `clients.id` (isolation) |
| `libelle` | Nom produit / libellé |
| `quantite` | Quantité vendue |
| `prix_unitaire` | Prix unitaire |
| `montant_paye` | Encaissé |
| `total_brut` | CA généré (colonne générée) |
| `reste_a_payer` | Reste dû (colonne générée) |
| `date` | Date métier principale |
| `statut` | Payé / Partiel / Impayé / Annulé… |
| `produit_id` | FK produit optionnelle |
| `created_at` | Fallback date |

**RLS :** policies `ash_dashboard_sale_*` via `ash_owns_client(client_id)`. Le backend utilise la **service role** → filtrage explicite `client_id = req.user.clientId`.

## Contrat `get_sales`

```json
{
  "period": "current_month",
  "startDate": "2026-08-01",
  "endDate": "2026-08-31",
  "product": "Poulet",
  "limit": 500,
  "order": "date_desc"
}
```

**Périodes supportées :** `today`, `yesterday`, `current_week`, `previous_week`, `current_month`, `previous_month`, `current_year`.

**Interdit :** `userId`, `clientId`, `user_id`, `client_id` — rejetés explicitement.

**Fuseau :** `ASH_LEDGER_TIMEZONE` (défaut `Africa/Kinshasa`).

## Contexte conversationnel

Stocké en mémoire serveur par `(user.id, sessionId)` — **sans** copie intégrale des données financières :

```json
{
  "topic": "sales",
  "intent": "query_sales",
  "filters": { "period": "current_month" },
  "lastTool": "get_sales",
  "updatedAt": "..."
}
```

### Mémoire vs données

| Contexte conversationnel | Données métier |
|--------------------------|----------------|
| Sujet, période, intention | Toujours relues via Supabase |
| Références (« mois dernier », « compare ») | Jamais réutilisées comme vérité |
| Paramètres du dernier tool | Servent à résoudre la suite |

## Flux complet

1. « Combien ai-je vendu ce mois-ci ? » → `get_sales({ period: 'current_month' })`
2. « Et le mois dernier ? » → contexte `sales` + `previous_month` → **nouveau** `get_sales`
3. « Compare les deux. » → deux appels `current_month` + `previous_month`
4. « Quel produit s'est le mieux vendu ? » → `get_sales` + agrégation `byProduct`

## Sécurité

- Token PocketBase obligatoire (`requireAuth`)
- `clientId` issu de `req.user` uniquement
- Service role jamais exposée
- Erreurs Supabase → `{ success: false, error: { code, message } }` sans SQL brut

## Futurs tools

Pattern à réutiliser :

```javascript
const context = createToolExecutionContext(req);
await executeTool('get_sales', context, validatedInput);
```

Chaque tool futur : validation input → service métier → scope client → Supabase.

## Exemple API

```http
POST /api/ashy/chat
Authorization: Bearer <pocketbase_token>
Content-Type: application/json

{
  "message": "Combien ai-je vendu ce mois-ci ?",
  "sessionId": "optional-session"
}
```

Réponse :

```json
{
  "reply": "Sur ce mois-ci, tu as enregistré …",
  "conversation": { "topic": "sales", "filters": { "period": "current_month" } },
  "toolResults": [{ "success": true, "tool": "get_sales", "meta": { "count": 10 } }]
}
```
