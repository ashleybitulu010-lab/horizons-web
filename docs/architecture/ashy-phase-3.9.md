# Ashy Phase 3.9 — routage frontend create_sale

> Feature flag `VITE_ASHY_WRITE_CHAT` (default **false**). n8n reste fallback et canal pour les autres writes.

## Objectif

Router les messages **create_sale** (`J'ai vendu…`, confirmation `oui`, slot-fill) vers `POST /api/ashy/chat` lorsque le flag write est ON.

## Flags

| Flag | Effet |
|------|--------|
| `VITE_ASHY_READ_CHAT=false` | Reads → n8n |
| `VITE_ASHY_WRITE_CHAT=false` | Ventes → n8n (comportement pré-3.9) |
| Write ON | create_sale → Ashy ; autres writes → n8n |
| Read ON | reads → Ashy (Phase 3.7) |

## Fichiers

- `src/lib/ashyWriteChatFlag.js`
- `src/lib/chatAshyWrite.js` — état pending + détection succès
- `src/lib/chatRouter.js` — classifier create_sale / confirmation
- `src/lib/chatReply.js` — refresh dashboard après vente Ashy
- `src/context/ChatContext.jsx` — `pendingAshyWriteRef`

## Confirmation multi-tour

1. Message vente → Ashy → preview (`NEEDS_CONFIRMATION`) → `pendingAshyWriteRef=true`
2. `oui` → Ashy (même `sessionId`) → RPC → refresh dashboard
3. Fallback n8n si Ashy échoue → pending cleared

## Tests

`node --test src/lib/chatRouter.test.js src/lib/chatTransport.test.js src/lib/chatAshyWrite.test.js`
