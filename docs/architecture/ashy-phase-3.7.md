# Ashy Phase 3.7 — Migration frontend chat (reads → `/api/ashy/chat`)

> Feature flag `VITE_ASHY_READ_CHAT` (default **false**). n8n reste actif pour writes, PDF, slot-filling et historique.

## Objectif

Router progressivement les **intentions read-only** (Phases 3.1–3.6) du chat principal vers `POST /api/ashy/chat`, sans modifier l’UX, sans toucher n8n/Supabase/write tools/PDF.

## Feature flag

| Valeur | Comportement |
|--------|--------------|
| `false` (défaut) | 100 % `POST /chat` → n8n (comportement pré-3.7) |
| `true` | Reads classifiés → `/api/ashy/chat` ; reste → n8n |

Variable : `VITE_ASHY_READ_CHAT=true` dans `.env` local uniquement pour tests.

## Architecture transport

```
sendMessage (ChatContext)
       │
 resolveChatRoute(message, flag)
       │
   ┌───┴────┐
   ▼        ▼
 Ashy      n8n (/chat)
 reads     writes, PDF, unknown, slot-fill
```

### Fichiers frontend

| Fichier | Rôle |
|---------|------|
| `src/lib/ashyReadChatFlag.js` | Lit `VITE_ASHY_READ_CHAT` |
| `src/lib/chatRouter.js` | Classifie read vs write (write-first, défaut n8n) |
| `src/lib/ashyChatApi.js` | Client `POST /api/ashy/chat` |
| `src/lib/n8nChatApi.js` | Client `POST /chat` (payload inchangé) |
| `src/lib/chatReply.js` | Parsing réponse commune (reply, PDF meta, erreurs) |
| `src/context/ChatContext.jsx` | Routeur + affichage inchangé |

## Classifier (sécurité)

1. Flag OFF → toujours n8n.
2. Patterns **write** → n8n (QuickAdd drafts, verbes transactionnels, corrections).
3. Demande **PDF** explicite → n8n.
4. Patterns **read** reconnus → Ashy.
5. **Défaut** → n8n (jamais de write accidentel vers Ashy).

## Contrats API

### Ashy `POST /api/ashy/chat`

**Request:** `{ message, sessionId }` + Bearer token.

**Response OK:** `{ reply, conversation?, toolResults? }`

**Response 422:** `{ error: { code, message } }`

### n8n `POST /chat`

Inchangé (proxy backend). PDF passthrough **hors périmètre** Phase 3.7.

## Préservation UX

- Messages, loading, erreurs, historique localStorage + `/history` + `/thread/message` : inchangés.
- `toolResults` Ashy attachés au message (sans rendu UI).
- `DASHBOARD_REFRESH_EVENT` : **uniquement** après réponse n8n OK (writes).
- Analytics : inchangés.

## Hors périmètre

- Passthrough PDF proxy n8n
- Write tools backend
- Workflows n8n
- Migrations Supabase
- `ChatPage.jsx` (si `ChatContext` suffit)

## Rollback

`VITE_ASHY_READ_CHAT=false` → retour immédiat au comportement pré-3.7.

## Tests

`node --test src/lib/chatRouter.test.js`

- Flag OFF → n8n pour tous les messages
- Flag ON → reads → ashy, writes/PDF → n8n
- Parsing réponses Ashy et n8n

## Validation manuelle

1. Flag OFF : vente + consultation → n8n
2. Flag ON : « Combien ai-je vendu ce mois-ci ? » → Ashy
3. Flag ON : « J'ai vendu 10 pains » → n8n
4. Flag ON : « Génère mon bilan PDF » → n8n
