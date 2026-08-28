# Ashy Phase 2.1 — Consolidation du socle agent

Phase 2.1 renforce l’architecture Ashy backend **sans** migrer n8n, **sans** ajouter de LLM, **sans** ajouter Redis, et **sans** implémenter de nouveaux tools métier (hors `get_sales`).

## Rôles

| Composant | Rôle |
|-----------|------|
| **Supabase** | Source de vérité des données métier (ventes, dépenses, stock, etc.) |
| **Ashy** | Agent qui comprend la demande, planifie les tools, interprète les résultats |
| **Mémoire conversationnelle** | Contexte de compréhension uniquement (topic, intent, références de période) |
| **Tools** | Contrat d’accès entre Ashy et les services backend |
| **Services** | Scope utilisateur + requêtes Supabase + transformation |

## Principe absolu

La mémoire conversationnelle **n’est jamais** une source de vérité financière.

Interdit d’utiliser comme substitut à Supabase :
- le texte précédent de la conversation ;
- une réponse Ashy précédente ;
- une donnée inventée par le modèle ;
- un total stocké en session.

Pour toute donnée métier : **relire Supabase via un tool**.

Si Supabase échoue : **signaler l’erreur**. Jamais de réponse de succès simulée.

## Flux agent

```
Message utilisateur
  ↓
Intent resolution layer (regex Phase 2.1, LLM futur)
  ↓
Intent structuré { intent, topic, filters, references, needsTool }
  ↓
Tool planner (plan générique, pas centré sur get_sales)
  ↓
Tool execution (registry)
  ↓
Service (scope auth + Supabase)
  ↓
ToolResult standardisé
  ↓
Response formatter (par type de réponse)
  ↓
Réponse utilisateur + mise à jour mémoire (contexte seulement)
```

## Mémoire conversationnelle

Abstraction : `conversation-store.js`

Interface :
- `getConversationState(userId, sessionId)`
- `saveConversationState(userId, sessionId, state)`
- `clearConversationState(userId, sessionId)`

Implémentation Phase 2.1 : `Map` en mémoire (TTL 2 h). Remplaçable plus tard par Supabase ou Redis sans réécrire l’agent.

Sémantique TTL :
- chaque entrée stocke `savedAt` (timestamp de dernière écriture) ;
- une session expire quand `now - savedAt > ttlMs` (défaut : 2 heures) ;
- le TTL est réinitialisé à chaque `saveConversationState`.

Structure d’état :

```json
{
  "topic": "sales",
  "intent": "query_sales",
  "filters": { "period": "current_month" },
  "references": {
    "lastPeriod": "current_month",
    "previousPeriod": "previous_month",
    "lastProduct": null,
    "lastEntity": "sales"
  },
  "lastTool": "get_sales",
  "lastAction": "query_sales",
  "updatedAt": "2026-08-28T..."
}
```

Contenu autorisé : topic, intent, filtres conversationnels, références (« le mois dernier », « les deux »).

Contenu interdit : soldes, CA, stock, dettes, ventes stockées comme vérité.

## Intent resolution

Couche pluggable dans `agent/intent-resolver/` :
- `regex-resolver.js` — fallback déterministe Phase 2.1 ;
- `index.js` — point d’entrée (futur : LLM puis fallback regex).

Sortie normalisée :

```json
{
  "intent": "query_sales",
  "topic": "sales",
  "filters": { "period": "current_month" },
  "references": { "lastPeriod": "current_month" },
  "needsTool": true,
  "resolver": "regex"
}
```

Exemples de continuité :
- « Et le mois dernier ? » → `previous_month`, nouvelle lecture Supabase ;
- « Compare les deux. » → utilise `references.lastPeriod` / `previousPeriod`, deux lectures ;
- « Combien ai-je dépensé ? » → `topic: expenses`, changement de domaine.

## Tool planner

`tool-planner.js` transforme l’intent en plan d’exécution générique :

```json
{
  "steps": [{ "tool": "get_sales", "input": { "period": "current_month" } }],
  "responseKind": "query_sales"
}
```

L’agent exécute les steps en boucle. Ajouter `get_expenses`, `get_stock`, etc. ne nécessite pas de réécrire l’orchestrateur.

## Contrat ToolResult

```json
{
  "success": true,
  "tool": "get_sales",
  "data": { "summary": {}, "sales": [] },
  "meta": { "period": "current_month" },
  "error": null
}
```

Erreur :

```json
{
  "success": false,
  "tool": "get_sales",
  "data": null,
  "meta": {},
  "error": { "code": "SUPABASE_ERROR", "message": "..." }
}
```

Chaîne : Ashy → Tool → Service → Supabase.

Les tools **ne reçoivent jamais** `userId`, `clientId`, `businessUserId`, `tenantId` depuis le message. L’identité vient de `req.user` via `createToolExecutionContext`.

## Registry des tools

Métadonnées explicites dans `tools/definitions.js` :

| Champ | Exemple read | Exemple write |
|-------|--------------|---------------|
| `access` | `read` | `write` |
| `implemented` | `true` / `false` | `false` (Phase 2.1) |
| `mutatesData` | `false` | `true` |
| `requiresConfirmation` | `false` | `true` |
| `sourceOfTruth` | `supabase` | `supabase` |
| `inputSchema` | JSON Schema | JSON Schema |

Tools planifiés : `get_sales` (implémenté), `get_expenses`, `get_stock`, `get_products`, `get_debts`, `create_sale`, `create_expense`, `update_sale`, `update_expense`, `adjust_stock`, `generate_report`.

## READ vs WRITE

**READ** (Phase 2.1) : lire/analyser via Supabase, réponse immédiate si succès.

**WRITE** (préparation Phase 3+) : politique dans `tools/write-policy.js` :

```
Ashy → compréhension → validation → tool write → Supabase → confirmation réelle → réponse
```

Règles :
- confirmation utilisateur obligatoire ;
- succès déclaré uniquement après réponse Supabase ;
- identité toujours depuis le contexte backend.

Aucun write tool n’est exécuté en Phase 2.1.

## Authentification et isolation

Inchangé depuis Phase 1 :
- token PocketBase vérifié par middleware `requireAuth` ;
- `req.user.clientId` scope toutes les requêtes Supabase ;
- rejet des paramètres d’identité arbitraires (`tools/validation.js`).

## Route API

`POST /api/ashy/chat` — parallèle à `POST /chat` (n8n, inchangé).

## Tests Phase 2.1

Scénarios couverts :
- A. ventes mois en cours ;
- B. follow-up mois dernier ;
- C. comparaison deux périodes ;
- D. meilleur produit ;
- E. bascule ventes → dépenses ;
- F. effacement store → nouvelle lecture Supabase ;
- G. Supabase indisponible → erreur, pas de faux total.

## Préparation Phase 3

- Implémenter `get_expenses`, `get_stock`, etc. via le même contrat ;
- Ajouter un intent resolver LLM retournant la même structure ;
- Migrer progressivement les workflows n8n tool par tool ;
- Remplacer le store mémoire par Redis ou Supabase si nécessaire ;
- Activer les write tools avec confirmation et validation Supabase.

## Phase 2.1 final architecture

```
Utilisateur
  ↓
Frontend
  ↓
POST /api/ashy/chat
  ↓
Auth / user context (PocketBase → req.user)
  ↓
Ashy orchestrator
  ↓
Intent resolution (regex Phase 2.1, LLM Phase 3+)
  ↓
Tool planner (steps génériques { tool, input, postProcess? })
  ↓
Tool registry
  ↓
Tool (validation entrée, pas d’identité modèle)
  ↓
Service (scope client_id depuis req.user)
  ↓
Supabase (source de vérité métier)
  ↓
ToolResult { success, tool, data, meta, error }
  ↓
Ashy (response formatter)
  ↓
Réponse utilisateur
  ↓
Conversation store (contexte de compréhension seulement)
```

Précisions finales :

- **Mémoire conversationnelle** : sert à comprendre (topic, références de période, dernier intent). Ne stocke jamais de totaux financiers.
- **Supabase** : seule source de vérité pour ventes, dépenses, stock, dettes.
- **Tools** : interface contrôlée entre Ashy et les services ; identité injectée par le backend.
- **Phase 3** : ajoutera le resolver LLM, de nouveaux tools read/write, et une migration n8n progressive (tool par tool, sans coupure brutale).
- **n8n** : reste actif en parallèle via `POST /chat` pendant toute la transition.

## Fichiers clés

```
apps/api/src/agent/
  conversation-store.js    # abstraction mémoire
  conversation-state.js    # modèle d'état + helpers références
  intent-resolver/         # couche résolution
  tool-planner.js          # plan d'exécution générique
  index.js                 # orchestrateur
  response-formatter.js    # formatters par responseKind

apps/api/src/tools/
  definitions.js           # métadonnées tools
  validation.js            # clés d'identité interdites
  write-policy.js          # contrat write futur
  registry.js              # exécution + liste
```
