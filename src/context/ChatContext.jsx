import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import apiServerClient from '@/lib/apiServerClient';
import { readStoredCurrencyPreference } from '@/lib/currency';
import { cleanUtf8Text, normalizeMessageText } from '@/lib/textEncoding';
import { trackChatMessageSent, trackFromAssistantReply, trackReportGenerated } from '@/lib/analytics';
import { DASHBOARD_REFRESH_EVENT } from '@/hooks/useDashboardData';
import {
  createPdfBlobUrl,
  downloadPdfFromBase64,
  isUsablePdfBase64,
  requiresUserGestureForPdfDownload,
} from '@/lib/pdfDownload';
import { saveGeneratedReport } from '@/lib/saveReport';
import { buildWelcomeContent, makeWelcomeMessage } from '@/lib/ashyChat';
import { parseChatReplyResponse } from '@/lib/chatReply';
import { resolveChatRoute } from '@/lib/chatRouter';
import { fetchChatResponse } from '@/lib/chatTransport';

export const WELCOME_MESSAGE = makeWelcomeMessage('');

const ChatContext = createContext(null);

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}

const getTime = () =>
  new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function storageKeyFor(userId) {
  return userId ? `ash_chat_messages_${userId}` : null;
}

function readStoredMessages(userId) {
  const key = storageKeyFor(userId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredMessages(userId, messages) {
  const key = storageKeyFor(userId);
  if (!key) return;
  try {
    // Never persist raw PDF base64 (too large for localStorage).
    const toSave = messages
      .filter((m) => m.id !== 'welcome')
      .map((m) => {
        if (!m?.pdf) return m;
        const { base64, url, ...pdfMeta } = m.pdf;
        return { ...m, pdf: pdfMeta };
      });
    localStorage.setItem(key, JSON.stringify(toSave));
  } catch {
    /* quota / private mode */
  }
}

function clearStoredMessages(userId) {
  const key = storageKeyFor(userId);
  if (key) localStorage.removeItem(key);
}

function mapApiMessages(apiMessages, currencySettings) {
  return apiMessages.map((m, i) => ({
    id: m.id || `loaded-${i}`,
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.role === 'user'
      ? cleanUtf8Text(m.content || m.message || '')
      : normalizeMessageText(m.content || m.message || '', currencySettings),
    time: m.timestamp
      ? new Date(m.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : '',
    status: 'read',
  }));
}

function mergeMessageLists(localMessages, remoteMessages) {
  const seen = new Set();
  const merged = [];
  for (const msg of [...localMessages, ...remoteMessages]) {
    if (!msg?.content) continue;
    const key = `${msg.role}:${msg.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(msg);
  }
  return merged;
}

function looksLikeUpstreamReconnect(text) {
  const t = String(text || '');
  return /reconnect(er|e|ion)?[\s']*(openai|l['’]?api|api|la conversation|conversation)|clé\s*api|api\s*key|fournir.*(clé|key)|nouvelle conversation(\s+ia)?|connecte[rz]?\s*(openai|l['’]?api)|session\s+openai|openai\s+(session|key|api)/i.test(t);
}

function sanitizeAssistantReply(text) {
  if (looksLikeUpstreamReconnect(text)) {
    return "Je t'écoute 😊 Reformule simplement ta demande et on continue.";
  }
  return text;
}

function resolveStorageId(user) {
  if (!user) return null;
  return user.airtableId || user.id || user.email || null;
}

export function ChatProvider({ children }) {
  const { user, token } = useAuth();
  const stableId = resolveStorageId(user);

  const [messages, setMessages] = useState(() => [makeWelcomeMessage('')]);
  const [newIds, setNewIds] = useState(() => new Set());
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const loadedForUser = useRef(null);

  useEffect(() => {
    const welcome = makeWelcomeMessage(user?.firstName);
    if (!stableId) {
      setMessages([welcome]);
      setHistoryLoading(false);
      loadedForUser.current = null;
      return;
    }

    const stored = readStoredMessages(stableId);
    if (stored?.length) {
      setMessages([welcome, ...stored.filter((m) => m.id !== 'welcome')]);
    } else {
      setMessages([welcome]);
    }

    if (loadedForUser.current === stableId) {
      setHistoryLoading(false);
      return;
    }
    loadedForUser.current = stableId;

    let cancelled = false;
    setHistoryLoading(true);

    (async () => {
      try {
        const currency = readStoredCurrencyPreference(user?.id);
        const headers = {
          'Content-Type': 'application/json; charset=UTF-8',
          Accept: 'application/json; charset=UTF-8',
        };
        if (token) headers.Authorization = `Bearer ${token}`;

        const res = await apiServerClient.fetch('/history', {
          method: 'POST',
          headers,
          body: JSON.stringify({ user_id: stableId, encoding: 'UTF-8' }),
        });

        if (!res.ok || cancelled) return;

        const data = await res.json();
        if (cancelled) return;

        const remote = data.success && Array.isArray(data.messages) && data.messages.length > 0
          ? mapApiMessages(data.messages, currency)
          : [];

        const localOnly = (readStoredMessages(stableId) || []).filter((m) => m.id !== 'welcome');
        const merged = mergeMessageLists(localOnly, remote);

        if (merged.length > 0) {
          setMessages([makeWelcomeMessage(user?.firstName), ...merged]);
          writeStoredMessages(stableId, merged);
        }
      } catch {
        /* historique non bloquant */
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [stableId, token, user?.id]);

  useEffect(() => {
    const content = buildWelcomeContent(user?.firstName);
    setMessages((prev) => {
      const welcome = prev.find((m) => m.id === 'welcome');
      if (!welcome || welcome.content === content) return prev;
      return prev.map((m) => (m.id === 'welcome' ? { ...m, content } : m));
    });
  }, [user?.firstName]);

  useEffect(() => {
    if (!stableId || messages.length <= 1) return;
    writeStoredMessages(stableId, messages);
  }, [messages, stableId]);

  const persist = useCallback(async (role, content) => {
    if (!stableId) return;
    try {
      const currency = readStoredCurrencyPreference(user?.id);
      const headers = {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json; charset=UTF-8',
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      await apiServerClient.fetch('/thread/message', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          userId: stableId,
          airtableId: user?.airtableId || null,
          pbUserId: user?.id || '',
          role,
          content,
          timestamp: new Date().toISOString(),
          email: user?.email || '',
          firstName: user?.firstName || '',
          lastName: user?.lastName || '',
          currency: currency.currency || currency.displayCurrency,
          ledgerCurrency: currency.currency || currency.ledgerCurrency,
          usdCdfRate: currency.usdCdfRate,
          encoding: 'UTF-8',
          emojiFont: 'Noto Color Emoji',
        }),
      });
    } catch {
      /* ignore */
    }
  }, [user, stableId, token]);

  const sendMessage = useCallback(async (text) => {
    const body = (text ?? '').trim();
    if (!body || loading) return;

    const id = Date.now();
    setMessages((prev) => {
      const next = [...prev, { id, role: 'user', content: body, time: getTime(), status: 'sent' }];
      if (stableId) writeStoredMessages(stableId, next);
      return next;
    });
    setNewIds((prev) => new Set(prev).add(id));
    setInput('');
    setLoading(true);

    setTimeout(() => {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: 'delivered' } : m)));
    }, 300);

    persist('user', body);
    trackChatMessageSent('main_chat');

    try {
      const currency = readStoredCurrencyPreference(user?.id);
      const recentMessages = [
        ...(readStoredMessages(stableId) || [])
          .filter((m) => m.id !== 'welcome' && m.content)
          .map((m) => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: String(m.content).slice(0, 800),
          })),
        { role: 'user', content: body },
      ].slice(-12);

      const sessionId = stableId || user?.email || 'default';
      const chatRoute = resolveChatRoute(body);

      const chatResponse = await fetchChatResponse({
        message: body,
        chatRoute,
        sessionId,
        user,
        stableId,
        currency,
        recentMessages,
        token,
      });

      const {
        rawReplyText,
        toolResults,
        hasPdf,
        pdfPayload,
        shouldRefreshDashboard,
      } = parseChatReplyResponse(chatResponse);
      let replyText = sanitizeAssistantReply(normalizeMessageText(rawReplyText, currency));
      if (!String(replyText || '').trim()) {
        replyText = "Je t'écoute 😊 Reformule simplement ta demande et on continue.";
      }
      let pdfMeta = null;

      if (hasPdf && pdfPayload) {
        const filename = pdfPayload.filename || 'bilan-ash-ledger.pdf';
        if (isUsablePdfBase64(pdfPayload.pdf_base64)) {
          try {
            const mimeType = pdfPayload.mime_type || 'application/pdf';
            const url = createPdfBlobUrl(pdfPayload.pdf_base64, mimeType);
            pdfMeta = { filename, url, mimeType, base64: pdfPayload.pdf_base64 };
            if (!requiresUserGestureForPdfDownload()) {
              downloadPdfFromBase64(pdfPayload.pdf_base64, filename);
            }
            if (!/📄|pdf|télécharg|telecharg/i.test(replyText)) {
              const hint = requiresUserGestureForPdfDownload()
                ? `\n\n📄 ${filename}\nAppuyez sur « Télécharger » ci-dessous.`
                : `\n\n📄 ${filename}`;
              replyText = `${replyText}${hint}`;
            }
            trackReportGenerated({ source: 'chat_pdf_download', report_type: 'monthly' });
            // Persist for /reports (PocketBase + local fallback).
            if (user?.id) {
              void saveGeneratedReport({
                userId: user.id,
                base64: pdfPayload.pdf_base64,
                filename,
                type: 'monthly',
              }).catch(() => {});
            }
          } catch {
            replyText = `${replyText}\n\n⚠️ Le PDF a été généré mais le téléchargement a échoué. Réessaie.`;
          }
        } else {
          replyText = `${replyText}\n\n⚠️ Le PDF n’a pas pu être joint (fichier vide). Réessaie dans un instant.`;
        }
      }

      const replyId = Date.now() + 1;
      setMessages((prev) => {
        const withStatus = prev.map((m) => (m.id === id ? { ...m, status: 'read' } : m));
        const next = [...withStatus, {
          id: replyId,
          role: 'assistant',
          content: replyText,
          time: getTime(),
          status: 'read',
          ...(pdfMeta ? { pdf: pdfMeta } : {}),
          ...(toolResults?.length ? { toolResults } : {}),
        }];
        if (stableId) writeStoredMessages(stableId, next);
        return next;
      });
      setNewIds((prev) => new Set(prev).add(replyId));
      persist('assistant', replyText);
      trackFromAssistantReply(replyText);
      if (shouldRefreshDashboard && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(DASHBOARD_REFRESH_EVENT));
      }
    } catch {
      const errId = Date.now() + 1;
      setMessages((prev) => {
        const withStatus = prev.map((m) => (m.id === id ? { ...m, status: 'read' } : m));
        const next = [...withStatus, { id: errId, role: 'assistant', content: 'Erreur de connexion. Vérifiez votre connexion et réessayez.', time: getTime(), status: 'read' }];
        if (stableId) writeStoredMessages(stableId, next);
        return next;
      });
      setNewIds((prev) => new Set(prev).add(errId));
    } finally {
      setLoading(false);
    }
  }, [loading, persist, token, user, stableId]);

  const reset = useCallback(() => {
    setMessages([makeWelcomeMessage(user?.firstName)]);
    setHistoryLoading(true);
    setNewIds(new Set());
    setInput('');
    loadedForUser.current = null;
  }, [user?.firstName]);

  const deleteMessages = useCallback((ids) => {
    const idSet = new Set((ids || []).map(String));
    if (!idSet.size) return;
    setMessages((prev) => {
      const next = prev.filter((m) => !idSet.has(String(m.id)) || m.id === 'welcome');
      if (stableId) writeStoredMessages(stableId, next);
      return next.length ? next : [makeWelcomeMessage(user?.firstName)];
    });
    setNewIds((prev) => {
      const next = new Set(prev);
      idSet.forEach((id) => next.delete(id));
      return next;
    });
  }, [stableId, user?.firstName]);

  return (
    <ChatContext.Provider value={{
      messages,
      newIds,
      input,
      setInput,
      loading,
      historyLoading,
      sendMessage,
      deleteMessages,
      reset,
    }}>
      {children}
    </ChatContext.Provider>
  );
}
