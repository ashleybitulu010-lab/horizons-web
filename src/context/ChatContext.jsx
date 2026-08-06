import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import apiServerClient from '@/lib/apiServerClient';
import { readStoredCurrencyPreference } from '@/lib/currency';
import { cleanUtf8Text, normalizeMessageText } from '@/lib/textEncoding';

export const WELCOME_MESSAGE = {
  id: 'welcome',
  role: 'assistant',
  content: '👋 Bienvenue sur Ash Ledger !\nJe suis Ash, ton copilote financier. 💰✨\nEnsemble, on va suivre tes ventes, tes dépenses, ton stock et faire grandir ton activité, sans te compliquer la vie. 🚀\nDis-moi simplement ce dont tu as besoin, je m\'occupe du reste. 😊',
  time: '09:00',
  status: 'read',
};

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
    const toSave = messages.filter((m) => m.id !== 'welcome');
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

function resolveStorageId(user) {
  if (!user) return null;
  return user.airtableId || user.id || user.email || null;
}

export function ChatProvider({ children }) {
  const { user, token } = useAuth();
  const stableId = resolveStorageId(user);

  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [newIds, setNewIds] = useState(() => new Set());
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const loadedForUser = useRef(null);

  useEffect(() => {
    if (!stableId) {
      setMessages([WELCOME_MESSAGE]);
      setHistoryLoading(false);
      loadedForUser.current = null;
      return;
    }

    const stored = readStoredMessages(stableId);
    if (stored?.length) {
      setMessages([WELCOME_MESSAGE, ...stored]);
    } else {
      setMessages([WELCOME_MESSAGE]);
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
          setMessages([WELCOME_MESSAGE, ...merged]);
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
          currency: currency.displayCurrency,
          ledgerCurrency: currency.ledgerCurrency,
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

    try {
      const currency = readStoredCurrencyPreference(user?.id);
      const headers = {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json; charset=UTF-8',
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await apiServerClient.fetch('/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: body,
          sessionId: stableId || user?.email || 'default',
          session_id: stableId || user?.email || 'default',
          userId: stableId || '',
          airtableId: user?.airtableId || null,
          pbUserId: user?.id || '',
          firstName: user?.firstName || user?.name?.split(' ')[0] || '',
          lastName: user?.lastName || user?.name?.split(' ').slice(1).join(' ') || '',
          email: user?.email || '',
          currency: currency.displayCurrency,
          ledgerCurrency: currency.ledgerCurrency,
          usdCdfRate: currency.usdCdfRate,
          encoding: 'UTF-8',
          responseEncoding: 'UTF-8',
          emojiFont: 'Noto Color Emoji',
          pdfEncoding: 'UTF-8',
          pdfEmojiFonts: [
            'Noto Color Emoji',
            'Apple Color Emoji',
            'Segoe UI Emoji',
          ],
          reportCurrency: currency.displayCurrency,
        }),
      });
      const data = await res.json();
      const rawReplyText = res.ok
        ? (data.reply || data.output || data.message || data.text || "Je n'ai pas reçu de réponse.")
        : (typeof data.error === 'string' ? data.error : data.error?.message || data.message || 'Une erreur est survenue. Veuillez réessayer.');
      const replyText = normalizeMessageText(rawReplyText, currency);

      const replyId = Date.now() + 1;
      setMessages((prev) => {
        const withStatus = prev.map((m) => (m.id === id ? { ...m, status: 'read' } : m));
        const next = [...withStatus, { id: replyId, role: 'assistant', content: replyText, time: getTime(), status: 'read' }];
        if (stableId) writeStoredMessages(stableId, next);
        return next;
      });
      setNewIds((prev) => new Set(prev).add(replyId));
      persist('assistant', replyText);
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
    setMessages([WELCOME_MESSAGE]);
    setHistoryLoading(true);
    setNewIds(new Set());
    setInput('');
    loadedForUser.current = null;
  }, []);

  return (
    <ChatContext.Provider value={{ messages, newIds, input, setInput, loading, historyLoading, sendMessage, reset }}>
      {children}
    </ChatContext.Provider>
  );
}
