import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import {
  Send, Menu, X, User, CreditCard, BarChart2, LayoutDashboard, Settings, LogOut,
  FileDown, Copy, Trash2, Forward, Check, Bell, HelpCircle, Package, Tag,
  ShoppingBag, Wallet,
} from 'lucide-react';
import SupportChatWidget from '@/components/SupportChatWidget';
import InstallAppBanner from '@/components/InstallAppBanner';
import EmojiText from '@/components/EmojiText';
import MessageActionSheet from '@/components/MessageActionSheet';
import AppBottomNav from '@/components/AppBottomNav';
import QuickAddSheet from '@/components/QuickAddSheet';
import ChatDesktopNav from '@/components/ChatDesktopNav';
import ChatContextPanel from '@/components/ChatContextPanel';
import { useAuth } from '@/hooks/useAuth';
import { motion, AnimatePresence } from 'framer-motion';
import { useChat } from '@/context/ChatContext';
import { readStoredCurrencyPreference } from '@/lib/currency';
import {
  compactSpacedDigits,
  normalizeChatIcons,
  normalizeMessageText,
} from '@/lib/textEncoding';
import pb from '@/lib/pocketbaseClient';
import { useLanguage } from '@/context/LanguageContext';
import { openPdfFromMeta } from '@/lib/pdfDownload';
import { ASHY_EXPLANATION, BRAND, LOGO_SYMBOL } from '@/lib/brandAssets';
import { ashyPoseForText, CHAT_SUGGESTIONS } from '@/lib/ashyChat';

const LONG_PRESS_MS = 480;
const LONG_PRESS_MOVE_PX = 12;

async function copyText(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function AshyAvatar({ src, size = 32 }) {
  return (
    <div
      className="flex-shrink-0 overflow-hidden rounded-full border border-white shadow-sm"
      style={{ width: size, height: size, backgroundColor: '#E9F1FB' }}
    >
      <img
        src={src || ASHY_EXPLANATION}
        alt=""
        draggable={false}
        className="h-full w-full object-contain object-center"
        style={{ imageRendering: 'auto' }}
      />
    </div>
  );
}

/* ── Status ticks ── */
function StatusTicks({ status }) {
  if (status === 'sent') {
    return (
      <span className="inline-flex items-center ml-1 opacity-80">
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 5L4 8L11 1" stroke="rgba(255,255,255,0.8)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    );
  }
  if (status === 'delivered') {
    return (
      <span className="inline-flex items-center ml-1 opacity-80">
        <svg width="16" height="10" viewBox="0 0 16 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 5L4 8L11 1" stroke="rgba(255,255,255,0.8)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M5 5L8 8L15 1" stroke="rgba(255,255,255,0.8)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    );
  }
  if (status === 'read') {
    return (
      <span className="inline-flex items-center ml-1">
        <svg width="16" height="10" viewBox="0 0 16 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 5L4 8L11 1" stroke="#93C5FD" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M5 5L8 8L15 1" stroke="#93C5FD" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    );
  }
  return null;
}

/* ── Typing indicator ── */
function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="flex items-end gap-2 px-4 py-1"
    >
      <AshyAvatar src={ashyPoseForText('', { typing: true })} size={32} />
      <div className="flex flex-col gap-0.5">
        <div className="px-4 py-3 rounded-2xl rounded-bl-sm shadow-sm" style={{ backgroundColor: '#FFFFFF' }}>
          <div className="flex gap-1.5 items-center" style={{ minWidth: 36 }}>
            {[0, 150, 300].map((delay, i) => (
              <span
                key={i}
                className="w-2 h-2 rounded-full animate-bounce"
                style={{ animationDelay: `${delay}ms`, backgroundColor: BRAND.orange, opacity: 0.7 }}
              />
            ))}
          </div>
        </div>
        <span className="text-[10px] text-gray-400 ml-1 font-medium">Ashy réfléchit…</span>
      </div>
    </motion.div>
  );
}

/* ── Single message ── */
function Message({
  message,
  isNew,
  currencySettings,
  selectMode,
  selected,
  onToggleSelect,
  onLongPress,
}) {
  const isUser = message.role === 'user';
  const isWelcome = message.id === 'welcome';
  const content = compactSpacedDigits(
    isUser
      ? normalizeChatIcons(message.content)
      : normalizeMessageText(message.content, currencySettings),
  );
  const pressTimer = useRef(null);
  const pressed = useRef(false);
  const pressOrigin = useRef(null);

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressOrigin.current = null;
  };

  const startPress = (e) => {
    if (selectMode || message.id === 'welcome') return;
    // Ignore multi-touch / right-click mouse quirks
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pressed.current = false;
    clearPress();
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = window.setTimeout(() => {
      pressed.current = true;
      pressOrigin.current = null;
      try { navigator.vibrate?.(18); } catch { /* ignore */ }
      onLongPress?.(message);
    }, LONG_PRESS_MS);
  };

  const movePress = (e) => {
    if (!pressTimer.current || !pressOrigin.current) return;
    const dx = e.clientX - pressOrigin.current.x;
    const dy = e.clientY - pressOrigin.current.y;
    if ((dx * dx) + (dy * dy) > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) {
      clearPress();
    }
  };

  const endPress = (e) => {
    const wasLong = pressed.current;
    clearPress();
    if (wasLong) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleClick = () => {
    if (selectMode) onToggleSelect?.(message.id);
  };

  return (
    <motion.div
      initial={isNew ? { opacity: 0, y: 10, scale: 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className={`flex items-end gap-2 px-4 py-0.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!selectMode && message.id !== 'welcome') onLongPress?.(message);
      }}
    >
      {selectMode && (
        <button
          type="button"
          aria-label={selected ? 'Désélectionner' : 'Sélectionner'}
          onClick={() => onToggleSelect?.(message.id)}
          className={`mb-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 ${
            selected ? 'border-orange-500 bg-orange-500 text-white' : 'border-stone-300 bg-white'
          }`}
        >
          {selected ? <Check size={14} strokeWidth={3} /> : null}
        </button>
      )}
      {!isUser && (
        <div className="mb-1">
          <AshyAvatar src={ashyPoseForText(content)} size={32} />
        </div>
      )}
      <div
        role="button"
        tabIndex={0}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerCancel={clearPress}
        onPointerMove={movePress}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (selectMode) onToggleSelect?.(message.id);
            else onLongPress?.(message);
          }
        }}
        className={`max-w-[72%] md:max-w-[55%] px-3.5 shadow-sm touch-manipulation select-none ${
          isWelcome ? 'py-2' : 'py-2.5'
        } ${
          isUser
            ? 'rounded-2xl rounded-br-sm text-white'
            : 'rounded-2xl rounded-bl-sm text-gray-900'
        } ${selected ? 'ring-2 ring-orange-400 ring-offset-1' : ''}`}
        style={{
          backgroundColor: isUser ? BRAND.orange : '#FFFFFF',
          WebkitUserSelect: 'none',
          userSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
      >
        <p
          className={`chat-text leading-relaxed whitespace-pre-wrap break-words ${
            isWelcome ? 'text-[13px]' : 'text-sm'
          }`}
          style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
        >
          <EmojiText>{content}</EmojiText>
        </p>
        {!isUser && message.pdf?.url && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              void openPdfFromMeta(message.pdf);
            }}
            className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white touch-manipulation"
            style={{ backgroundColor: BRAND.orange }}
          >
            <FileDown size={14} />
            Télécharger {message.pdf.filename || 'le PDF'}
          </button>
        )}
        <div className="flex items-center justify-end gap-0.5 mt-1">
          <span
            dir="ltr"
            className={`chat-time text-[10px] select-none font-medium ${isUser ? 'text-orange-200' : 'text-gray-400'}`}
          >
            {message.time}
          </span>
          {isUser && <StatusTicks status={message.status || 'sent'} />}
        </div>
      </div>
    </motion.div>
  );
}

/* ── Date divider ── */
function DateDivider({ label }) {
  return (
    <div className="flex items-center gap-3 px-6 py-3">
      <div className="flex-1 h-px bg-gray-200/60" />
      <span className="text-xs text-gray-400 font-medium px-3 py-1 rounded-full bg-white/60 shadow-sm backdrop-blur-sm">{label}</span>
      <div className="flex-1 h-px bg-gray-200/60" />
    </div>
  );
}

/* ── Side drawer ── */
const MENU_ITEMS = [
  { icon: LayoutDashboard, label: "Vue d'ensemble", route: '/dashboard' },
  { icon: BarChart2, label: 'Mes rapports', route: '/reports' },
  { icon: ShoppingBag, label: 'Ventes', draft: "J'ai vendu " },
  { icon: Wallet, label: 'Dépenses', draft: "J'ai dépensé " },
  { icon: Tag, label: 'Produits', draft: 'Je veux ajouter un nouveau produit', send: true },
  { icon: Package, label: 'Stock', draft: "J'ai reçu du stock " },
  { icon: User, label: 'Profil', route: '/profile' },
  { icon: CreditCard, labelKey: 'nav.subscription', route: '/subscription' },
  { icon: Settings, labelKey: 'nav.settings', route: '/settings' },
  { icon: HelpCircle, label: 'Aide & Support', action: 'support' },
];

function SideDrawer({ open, onClose, onLogout, onNavigate, onSupport, onDraft, user }) {
  const { t } = useLanguage();
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || null);

  useEffect(() => {
    setAvatarUrl(user?.avatarUrl || null);
  }, [user?.avatarUrl]);

  useEffect(() => {
    if (!open || !user?.id) return undefined;
    let cancelled = false;
    pb.collection('users').getOne(user.id)
      .then((rec) => {
        if (cancelled) return;
        if (rec?.avatar) {
          try {
            setAvatarUrl(pb.files.getURL(rec, rec.avatar));
          } catch {
            /* keep previous */
          }
        } else {
          setAvatarUrl(null);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, user?.id]);

  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase()
    || (user?.email?.[0] || '?').toUpperCase();

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            onClick={onClose}
          />
          {/* Drawer panel */}
          <motion.div
            key="drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-72 flex flex-col shadow-2xl"
            style={{ backgroundColor: '#FFFFFF' }}
          >
            {/* Drawer header — profile photo (same as Profil page) */}
            <div className="flex items-center justify-between px-5 py-4" style={{ backgroundColor: BRAND.navy }}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-white/40 shadow flex-shrink-0 bg-white/20">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={t('nav.avatarAlt')} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-sm font-bold text-white">
                      {initials}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-white font-semibold text-sm leading-tight truncate">
                    {user?.name || user?.email?.split('@')[0] || t('nav.user')}
                  </p>
                  <p className="text-blue-100 text-xs truncate max-w-[160px]">{user?.email || ''}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="min-w-11 min-h-11 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/15 transition-colors"
                aria-label="Fermer le menu"
              >
                <X size={18} />
              </button>
            </div>

            {/* Menu items */}
            <nav className="flex-1 py-4 px-3 flex flex-col gap-1">
              {MENU_ITEMS.map(({ icon: Icon, labelKey, label, route, action, draft, send }) => (
                <button
                  key={labelKey || label}
                  onClick={() => {
                    onClose();
                    if (action === 'support') onSupport?.();
                    else if (draft) onDraft?.({ draft, send });
                    else if (route) onNavigate(route);
                  }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-gray-700 hover:bg-orange-50 hover:text-orange-600 transition-colors text-sm font-medium active:scale-[0.98] group"
                >
                  <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 group-hover:bg-orange-100 transition-colors">
                    <Icon size={17} strokeWidth={1.8} className="group-hover:text-orange-500 transition-colors" />
                  </span>
                  {labelKey ? t(labelKey) : label}
                </button>
              ))}
            </nav>

            {/* Divider + logout */}
            <div className="px-3 pb-6">
              <div className="h-px bg-gray-100 mb-3" />
              <button
                onClick={() => { onClose(); onLogout(); }}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-red-500 hover:bg-red-50 transition-colors text-sm font-medium active:scale-[0.98] group"
              >
                <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 group-hover:bg-red-100 transition-colors">
                  <LogOut size={17} strokeWidth={1.8} />
                </span>
                {t('nav.logout')}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── Main chat page ── */
export default function ChatPage() {
  const { user, logout } = useAuth();
  const currencySettings = readStoredCurrencyPreference(user?.id);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    messages, newIds, input, setInput, loading, historyLoading, sendMessage, deleteMessages,
  } = useChat();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [toast, setToast] = useState(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const messagesInnerRef = useRef(null);
  const textareaRef = useRef(null);
  const prevHistoryLoadingRef = useRef(historyLoading);
  const consumedNavState = useRef(false);
  const [viewportHeight, setViewportHeight] = useState(null);
  const [viewportOffset, setViewportOffset] = useState(0);

  const hasUserHistory = messages.some((m) => m.id !== 'welcome' && m.role === 'user');
  const showSuggestions = !historyLoading && !hasUserHistory;

  const applyDraft = useCallback((draft) => {
    setInput(draft);
    setQuickAddOpen(false);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
      const len = el.value.length;
      try { el.setSelectionRange(len, len); } catch { /* ignore */ }
    });
  }, [setInput]);

  const runSuggestion = useCallback((item) => {
    const draft = String(item?.draft || '');
    if (!draft) return;
    setQuickAddOpen(false);
    if (item.send) {
      if (loading) {
        applyDraft(draft);
        return;
      }
      sendMessage(draft);
      return;
    }
    applyDraft(draft);
  }, [applyDraft, loading, sendMessage]);

  const showToast = useCallback((text) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 1800);
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id) => {
    if (id === 'welcome') return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectedMessages = messages.filter((m) => selectedIds.has(String(m.id)));

  const handleMessageAction = useCallback(async (action, message) => {
    setActionMessage(null);
    const text = String(message?.content || '').trim();

    if (action === 'copy') {
      const ok = await copyText(text);
      showToast(ok ? 'Message copié' : 'Impossible de copier');
      return;
    }
    if (action === 'reply') {
      setReplyTo(message);
      textareaRef.current?.focus();
      return;
    }
    if (action === 'forward') {
      try {
        if (navigator.share) {
          await navigator.share({ text });
          return;
        }
      } catch {
        /* user cancelled or share failed */
      }
      const ok = await copyText(text);
      showToast(ok ? 'Message copié pour transfert' : 'Transfert impossible');
      return;
    }
    if (action === 'select') {
      setSelectMode(true);
      setSelectedIds(new Set([String(message.id)]));
      return;
    }
    if (action === 'delete') {
      if (message?.role !== 'user' || message.id === 'welcome') return;
      deleteMessages([message.id]);
      showToast('Message supprimé');
    }
  }, [deleteMessages, showToast]);

  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const scroll = () => {
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
    };

    scroll();
    requestAnimationFrame(() => requestAnimationFrame(scroll));
    [50, 120, 250, 400, 650].forEach((ms) => setTimeout(scroll, ms));
  }, []);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;

    const update = () => {
      setViewportHeight(vv.height);
      setViewportOffset(vv.offsetTop || 0);
      scrollToBottom();
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [scrollToBottom]);

  useEffect(() => {
    const inner = messagesInnerRef.current;
    if (!inner || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => scrollToBottom());
    observer.observe(inner);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  useEffect(() => {
    if (prevHistoryLoadingRef.current && !historyLoading) {
      scrollToBottom();
    }
    prevHistoryLoadingRef.current = historyLoading;
  }, [historyLoading, scrollToBottom]);

  const submit = () => {
    if (!input.trim() || loading) return;
    let payload = input.trim();
    if (replyTo?.content) {
      const snippet = String(replyTo.content).replace(/\s+/g, ' ').slice(0, 120);
      payload = `↩ ${snippet}${String(replyTo.content).length > 120 ? '…' : ''}\n\n${payload}`;
    }
    sendMessage(payload);
    setReplyTo(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    scrollToBottom();
  };

  const handleKeyDown = (e) => {
    if (
      e.key === 'Enter'
      && !e.shiftKey
      && (e.ctrlKey || e.metaKey)
      && !e.nativeEvent?.isComposing
    ) {
      e.preventDefault();
      submit();
    }
  };

  const handleTextareaChange = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 144) + 'px';
  };

  const handleTextareaFocus = () => {
    scrollToBottom();
    setTimeout(scrollToBottom, 150);
    setTimeout(scrollToBottom, 400);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  useEffect(() => {
    const state = location.state || {};
    const hasNavState = Boolean(state.openQuickAdd || state.draft || state.openSupport);
    if (!hasNavState) {
      consumedNavState.current = false;
      return;
    }
    if (consumedNavState.current) return;
    consumedNavState.current = true;
    if (state.openQuickAdd) {
      setQuickAddOpen(true);
    }
    if (state.draft) {
      runSuggestion({ draft: state.draft, send: state.send });
    }
    if (state.openSupport) {
      try { window.dispatchEvent(new CustomEvent('ash:open-support')); } catch { /* ignore */ }
    }
    navigate('.', { replace: true, state: {} });
  }, [location.state, runSuggestion, navigate]);

  useEffect(() => {
    const open = () => setQuickAddOpen(true);
    window.addEventListener('ash:open-quick-add', open);
    return () => window.removeEventListener('ash:open-quick-add', open);
  }, []);

  const openSupport = useCallback(() => {
    try { window.dispatchEvent(new CustomEvent('ash:open-support')); } catch { /* ignore */ }
  }, []);

  return (
    <>
      <Helmet>
        <title>Chat — Ash Ledger</title>
        <meta name="description" content="Gérez vos finances, ventes, dépenses, stocks et rapports grâce à l'intelligence artificielle." />
      </Helmet>

      <div
        className="fixed left-0 w-full flex overflow-hidden"
        style={{
          top: viewportOffset,
          backgroundColor: BRAND.bg,
          height: viewportHeight ? `${viewportHeight}px` : '100dvh',
        }}
      >
        <ChatDesktopNav />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* ── Header ── */}
        <header
          className="safe-area-top sticky top-0 z-30 flex flex-shrink-0 items-center gap-2 px-3 py-2 lg:px-4"
          style={{
            backgroundColor: BRAND.white,
            borderBottom: '1px solid rgba(23, 32, 51, 0.06)',
            boxShadow: '0 1px 8px rgba(23, 59, 115, 0.04)',
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <img src={LOGO_SYMBOL} alt="" className="h-8 w-8 flex-shrink-0 object-contain" />
            <h1 className="truncate text-sm font-semibold tracking-tight lg:text-base" style={{ color: BRAND.navy }} translate="no">
              Ash Ledger
            </h1>
          </div>
          <button
            type="button"
            onClick={openSupport}
            className="flex h-11 w-11 items-center justify-center rounded-full active:bg-stone-100"
            style={{ color: BRAND.navy }}
            aria-label="Notifications"
          >
            <Bell size={20} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-full active:bg-stone-100"
            style={{ color: BRAND.navy }}
            aria-label="Menu"
          >
            <Menu size={20} strokeWidth={2} />
          </button>
        </header>

        <div
          className="flex flex-shrink-0 items-center gap-3 px-4 py-2.5"
          style={{ backgroundColor: BRAND.white, borderBottom: '1px solid rgba(23, 32, 51, 0.05)' }}
        >
          <AshyAvatar src={ASHY_EXPLANATION} size={40} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold" style={{ color: BRAND.text }} translate="no">Ashy</p>
              <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: '#16A384' }}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                En ligne
              </span>
            </div>
            <p className="text-xs" style={{ color: BRAND.textMuted }}>Ton assistant financier</p>
          </div>
        </div>

        <InstallAppBanner />

        {/* ── Messages area ── */}
        <div
          ref={messagesContainerRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-3 space-y-1 relative select-none"
          onContextMenu={(e) => e.preventDefault()}
          style={{
            WebkitUserSelect: 'none',
            userSelect: 'none',
            WebkitTouchCallout: 'none',
            overflowAnchor: 'none',
            WebkitOverflowScrolling: 'touch',
            backgroundColor: '#F8FAFD',
          }}
        >
          {/* Content above background */}
          <div ref={messagesInnerRef} className="relative pb-6 lg:pb-4" style={{ zIndex: 1 }}>
            {historyLoading && (
              <div className="flex flex-col items-center justify-center gap-4 px-4 py-10">
                <div className="flex gap-1.5 items-center">
                  {[0, 150, 300].map((delay, i) => (
                    <span
                      key={i}
                      className="w-2.5 h-2.5 rounded-full animate-bounce"
                      style={{ animationDelay: `${delay}ms`, backgroundColor: BRAND.orange, opacity: 0.7 }}
                    />
                  ))}
                </div>
                <p className="text-sm text-gray-400 font-medium">Chargement de votre historique…</p>
                <div className="flex flex-col gap-3 w-full mt-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className={`h-10 rounded-2xl bg-white/60 animate-pulse ${i % 2 ? 'self-end w-1/2' : 'w-2/3'}`}
                    />
                  ))}
                </div>
              </div>
            )}
            <DateDivider label="Aujourd'hui" />
            <AnimatePresence initial={false}>
              {messages.map(msg => (
                <Message
                  key={msg.id}
                  message={msg}
                  isNew={newIds.has(msg.id)}
                  currencySettings={currencySettings}
                  selectMode={selectMode}
                  selected={selectedIds.has(String(msg.id))}
                  onToggleSelect={toggleSelect}
                  onLongPress={setActionMessage}
                />
              ))}
            </AnimatePresence>
            {showSuggestions && (
              <div className="px-4 pb-3 pt-2">
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  {CHAT_SUGGESTIONS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => runSuggestion(item)}
                      className="flex min-h-[52px] flex-col items-start justify-center rounded-2xl bg-white px-3 py-2 text-left shadow-sm active:scale-[0.98]"
                      style={{ border: '1px solid rgba(23,32,51,0.06)' }}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: BRAND.text }}>
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                        {item.label}
                      </span>
                      <span className="text-[11px]" style={{ color: BRAND.textMuted }}>{item.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <AnimatePresence>
              {loading && <TypingIndicator key="typing" />}
            </AnimatePresence>
            <div ref={messagesEndRef} aria-hidden="true" style={{ height: 1, scrollMarginBottom: 24 }} />
          </div>
        </div>

        {/* ── Selection toolbar ── */}
        {selectMode ? (
          <div
            className="flex-shrink-0 px-3 pt-2 flex items-center gap-2"
            style={{
              backgroundColor: '#1C1917',
              paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
            }}
          >
            <button
              type="button"
              onClick={exitSelectMode}
              className="rounded-full p-2 text-white/80 active:bg-white/10"
              aria-label="Annuler la sélection"
            >
              <X size={20} />
            </button>
            <p className="flex-1 text-sm font-semibold text-white">
              {selectedIds.size} sélectionné{selectedIds.size > 1 ? 's' : ''}
            </p>
            <button
              type="button"
              disabled={!selectedIds.size}
              onClick={async () => {
                const text = selectedMessages.map((m) => m.content).join('\n\n');
                const ok = await copyText(text);
                showToast(ok ? 'Copié' : 'Impossible de copier');
              }}
              className="rounded-full p-2 text-white disabled:opacity-40 active:bg-white/10"
              aria-label="Copier"
            >
              <Copy size={18} />
            </button>
            <button
              type="button"
              disabled={!selectedIds.size}
              onClick={async () => {
                const text = selectedMessages.map((m) => m.content).join('\n\n');
                try {
                  if (navigator.share) {
                    await navigator.share({ text });
                    return;
                  }
                } catch { /* ignore */ }
                const ok = await copyText(text);
                showToast(ok ? 'Copié pour transfert' : 'Transfert impossible');
              }}
              className="rounded-full p-2 text-white disabled:opacity-40 active:bg-white/10"
              aria-label="Transférer"
            >
              <Forward size={18} />
            </button>
            <button
              type="button"
              disabled={!selectedMessages.some((m) => m.role === 'user')}
              onClick={() => {
                const ids = selectedMessages.filter((m) => m.role === 'user').map((m) => m.id);
                deleteMessages(ids);
                exitSelectMode();
                showToast('Messages supprimés');
              }}
              className="rounded-full p-2 text-red-300 disabled:opacity-40 active:bg-white/10"
              aria-label="Supprimer"
            >
              <Trash2 size={18} />
            </button>
          </div>
        ) : (
          <>
            {replyTo && (
              <div className="flex-shrink-0 px-4 pt-2">
                <div className="flex items-start gap-2 rounded-2xl border border-orange-100 bg-white px-3 py-2 shadow-sm">
                  <div className="min-w-0 flex-1 border-l-2 border-orange-500 pl-2">
                    <p className="text-[11px] font-semibold text-orange-600">
                      {replyTo.role === 'user' ? 'Vous' : 'Ashy'}
                    </p>
                    <p className="truncate text-xs text-stone-500">
                      {String(replyTo.content || '').replace(/\s+/g, ' ')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyTo(null)}
                    className="rounded-full p-1 text-stone-400 active:bg-stone-100"
                    aria-label="Annuler la réponse"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* ── Input bar ── */}
            <div
              className="flex-shrink-0 px-3 pt-2 flex items-end gap-2 sm:px-4 sm:gap-3"
              style={{
                backgroundColor: BRAND.white,
                borderTop: '1px solid rgba(23,32,51,0.06)',
                paddingBottom: 8,
              }}
            >
              <div className="flex-1 bg-[#F8FAFD] rounded-3xl overflow-hidden flex items-end px-4 py-2.5 border border-stone-100" style={{ minHeight: 48 }}>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleTextareaChange}
                  onFocus={handleTextareaFocus}
                  onKeyDown={handleKeyDown}
                  enterKeyHint="enter"
                  placeholder={historyLoading ? 'Chargement de l\'historique…' : 'Écris ton message…'}
                  rows={1}
                  disabled={historyLoading}
                  className="chat-input w-full resize-none bg-transparent text-sm placeholder-gray-400 outline-none leading-relaxed max-h-36 disabled:opacity-50"
                  style={{ minHeight: 24, color: BRAND.text }}
                />
              </div>

              <motion.button
                type="button"
                onClick={submit}
                disabled={loading || !input.trim()}
                className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-white active:scale-95 transition-transform disabled:opacity-40"
                style={{ backgroundColor: BRAND.orange, boxShadow: '0 4px 12px rgba(255,112,0,0.32)' }}
                aria-label="Envoyer"
              >
                <Send style={{ width: 18, height: 18 }} strokeWidth={2.5} />
              </motion.button>
            </div>
          </>
        )}

        <AppBottomNav />
        </div>
        <ChatContextPanel />
      </div>

      <MessageActionSheet
        open={Boolean(actionMessage)}
        message={actionMessage}
        preview={actionMessage ? String(actionMessage.content || '').replace(/\s+/g, ' ').slice(0, 160) : ''}
        onClose={() => setActionMessage(null)}
        onAction={handleMessageAction}
      />

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="pointer-events-none fixed inset-x-0 z-[95] flex justify-center px-4"
            style={{ bottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
          >
            <div className="rounded-full bg-stone-900/90 px-4 py-2 text-xs font-semibold text-white shadow-lg">
              {toast}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Side drawer ── */}
      <SideDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onLogout={handleLogout}
        onNavigate={(route) => navigate(route)}
        onDraft={runSuggestion}
        onSupport={openSupport}
        user={user}
      />

      <QuickAddSheet
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onPick={runSuggestion}
      />

      {/* ── Support chat widget ── */}
      <SupportChatWidget user={user} hideLauncher />
    </>
  );
}
