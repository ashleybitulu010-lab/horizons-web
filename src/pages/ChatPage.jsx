import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { Send, Menu, X, User, CreditCard, BarChart2, LayoutDashboard, Settings, LogOut, Sparkles } from 'lucide-react';
import SupportChatWidget from '@/components/SupportChatWidget';
import EmojiText from '@/components/EmojiText';
import { useAuth } from '@/hooks/useAuth';
import { motion, AnimatePresence } from 'framer-motion';
import { useChat } from '@/context/ChatContext';
import { readStoredCurrencyPreference } from '@/lib/currency';
import {
  cleanUtf8Text,
  compactSpacedDigits,
  normalizeMessageText,
} from '@/lib/textEncoding';
import {
  persistRelaunchGuide,
  useOnboarding,
  ONBOARDING_RELAUNCH_EVENT,
} from '@/hooks/useOnboarding';

const ASH_AVATAR = 'https://horizons-cdn.hostinger.com/29358ba6-568b-49c6-9aac-6ece4b30fac6/ca8bd733c63d36fa2caff0db62fb3057.png';

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
      <div className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden border-2 border-white/60 shadow-sm">
        <img src={ASH_AVATAR} alt="Ash Ledger" className="w-full h-full object-cover" />
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="px-4 py-3 rounded-2xl rounded-bl-sm shadow-sm" style={{ backgroundColor: '#FFFFFF' }}>
          <div className="flex gap-1.5 items-center" style={{ minWidth: 36 }}>
            {[0, 150, 300].map((delay, i) => (
              <span
                key={i}
                className="w-2 h-2 rounded-full animate-bounce"
                style={{ animationDelay: `${delay}ms`, backgroundColor: '#FF6B00', opacity: 0.7 }}
              />
            ))}
          </div>
        </div>
        <span className="text-[10px] text-gray-400 ml-1 font-medium">Ash Ledger est en train d'écrire…</span>
      </div>
    </motion.div>
  );
}

/* ── Single message ── */
function Message({ message, isNew, currencySettings }) {
  const isUser = message.role === 'user';
  const content = compactSpacedDigits(
    isUser
      ? cleanUtf8Text(message.content)
      : normalizeMessageText(message.content, currencySettings),
  );
  return (
    <motion.div
      initial={isNew ? { opacity: 0, y: 10, scale: 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className={`flex items-end gap-2 px-4 py-0.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden border-2 border-white/60 shadow-sm mb-1">
          <img src={ASH_AVATAR} alt="Ash Ledger" className="w-full h-full object-cover" />
        </div>
      )}
      <div
        className={`max-w-[72%] md:max-w-[55%] px-3.5 py-2.5 shadow-sm ${
          isUser
            ? 'rounded-2xl rounded-br-sm text-white'
            : 'rounded-2xl rounded-bl-sm text-gray-900'
        }`}
        style={isUser ? { backgroundColor: '#FF6B00' } : { backgroundColor: '#FFFFFF' }}
      >
        <p className="chat-text text-sm leading-relaxed whitespace-pre-wrap break-words">
          <EmojiText>{content}</EmojiText>
        </p>
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
  { icon: Sparkles, label: 'Guide Ashy', action: 'guide' },
  { icon: LayoutDashboard, label: 'Tableau de bord', route: '/dashboard' },
  { icon: User, label: 'Mon profil', route: '/profile' },
  { icon: CreditCard, label: 'Mon abonnement', route: '/subscription' },
  { icon: BarChart2, label: 'Mes rapports', route: '/reports' },
  { icon: Settings, label: 'Paramètres', route: '/settings' },
];

function SideDrawer({ open, onClose, onLogout, onNavigate, onGuide, user }) {
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
            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-4" style={{ backgroundColor: '#FF6B00' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-white/40 shadow">
                  <img src={ASH_AVATAR} alt="Ash Ledger" className="w-full h-full object-cover" />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm leading-tight">
                    {user?.name || user?.email?.split('@')[0] || 'Utilisateur'}
                  </p>
                  <p className="text-orange-100 text-xs truncate max-w-[140px]">{user?.email || ''}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/15 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Menu items */}
            <nav className="flex-1 py-4 px-3 flex flex-col gap-1">
              {MENU_ITEMS.map(({ icon: Icon, label, route, action }) => (
                <button
                  key={label}
                  onClick={() => {
                    onClose();
                    if (action === 'guide') onGuide?.();
                    else if (route) onNavigate(route);
                  }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-gray-700 hover:bg-orange-50 hover:text-orange-600 transition-colors text-sm font-medium active:scale-[0.98] group"
                >
                  <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 group-hover:bg-orange-100 transition-colors">
                    <Icon size={17} strokeWidth={1.8} className="group-hover:text-orange-500 transition-colors" />
                  </span>
                  {label}
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
                Déconnexion
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
  const { messages, newIds, input, setInput, loading, historyLoading, sendMessage } = useChat();
  const { isGuideMode, isPending, isActive } = useOnboarding(user?.id, user?.created);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const messagesInnerRef = useRef(null);
  const textareaRef = useRef(null);
  const prevHistoryLoadingRef = useRef(historyLoading);
  const [viewportHeight, setViewportHeight] = useState(null);
  const [viewportOffset, setViewportOffset] = useState(0);

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
    sendMessage(input);
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

  const handleLogout = () => { logout(); navigate('/login', { replace: true }); };

  return (
    <>
      <Helmet>
        <title>Chat — Ash Ledger</title>
        <meta name="description" content="Gérez vos finances, ventes, dépenses, stocks et rapports grâce à l'intelligence artificielle." />
      </Helmet>

      <div
        className="fixed left-0 w-full flex flex-col overflow-hidden"
        style={{
          top: viewportOffset,
          backgroundColor: '#EDE8E0',
          height: viewportHeight ? `${viewportHeight}px` : '100dvh',
        }}
      >

        {/* ── Header ── */}
        <header
          className="sticky top-0 flex items-center gap-3 px-4 py-3 z-30 flex-shrink-0"
          style={{ backgroundColor: '#FF6B00', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
        >
          <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 border-2 border-white/40 shadow-md">
            <img src={ASH_AVATAR} alt="Ash Ledger" className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-white font-semibold text-base leading-tight tracking-tight" translate="no">Ash Ledger</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-green-300 flex-shrink-0" style={{ boxShadow: '0 0 0 2px rgba(255,255,255,0.35)' }} />
              <span className="text-orange-100 text-xs font-medium">En ligne</span>
            </div>
          </div>
          {/* Hamburger menu button */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors active:scale-95"
            aria-label="Menu"
          >
            <Menu size={22} strokeWidth={2} />
          </button>
        </header>

        {isGuideMode && (
          <div
            className="flex-shrink-0 px-4 py-3 flex items-center gap-3 border-b"
            style={{ backgroundColor: '#FFF4EB', borderColor: 'rgba(255,107,0,0.18)' }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-orange-700">
                {isPending ? 'Ashy est prêt à vous guider' : 'Guide Ashy en cours'}
              </p>
              <p className="text-xs text-orange-600/80 mt-0.5">
                Ouvrez le panneau Ashy en bas à droite pour commencer (produit → stock → vente…).
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (user?.id) persistRelaunchGuide(user.id);
                try {
                  window.dispatchEvent(new CustomEvent(ONBOARDING_RELAUNCH_EVENT));
                } catch { /* ignore */ }
              }}
              className="flex-shrink-0 px-3 py-2 rounded-xl text-white text-xs font-semibold active:scale-95"
              style={{ backgroundColor: '#FF6B00' }}
            >
              Ouvrir Ashy
            </button>
          </div>
        )}

        {/* ── Messages area ── */}
        <div
          ref={messagesContainerRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-3 space-y-1 relative"
          style={{
            overflowAnchor: 'none',
            WebkitOverflowScrolling: 'touch',
            background: `
              linear-gradient(160deg,
                #fdf8f2 0%,
                #fef5ec 30%,
                #fdf6ee 60%,
                #faf4ef 100%
              )
            `,
          }}
        >
          {/* Premium background layer – Ash Ledger Telegram-style icon grid */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
            {/* Very soft radial depth */}
            <div style={{ position: 'absolute', top: '0%', right: '0%', width: 500, height: 500, background: 'radial-gradient(circle, rgba(255,107,0,0.03) 0%, transparent 70%)', borderRadius: '50%' }} />
            <div style={{ position: 'absolute', bottom: '0%', left: '0%', width: 400, height: 400, background: 'radial-gradient(circle, rgba(204,136,68,0.025) 0%, transparent 70%)', borderRadius: '50%' }} />
            <div style={{ position: 'absolute', top: '50%', left: '50%', width: 600, height: 600, background: 'radial-gradient(circle, rgba(255,140,58,0.02) 0%, transparent 70%)', borderRadius: '50%', transform: 'translate(-50%,-50%)' }} />

            {/* Full-surface icon grid via SVG pattern */}
            <svg xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              <defs>
                {/* Bar chart icon */}
                <symbol id="ic-bar" viewBox="0 0 32 32">
                  <rect x="2" y="18" width="5" height="12" rx="1" fill="#CC8844"/>
                  <rect x="9" y="12" width="5" height="18" rx="1" fill="#CC8844"/>
                  <rect x="16" y="7" width="5" height="23" rx="1" fill="#CC8844"/>
                  <rect x="23" y="3" width="5" height="27" rx="1" fill="#CC8844"/>
                </symbol>
                {/* Line chart icon */}
                <symbol id="ic-line" viewBox="0 0 32 32">
                  <polyline points="2,24 8,16 14,20 20,10 26,8 30,4" stroke="#CC8844" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                  <line x1="2" y1="27" x2="30" y2="27" stroke="#CC8844" strokeWidth="1.2" strokeLinecap="round"/>
                  <line x1="2" y1="27" x2="2" y2="3" stroke="#CC8844" strokeWidth="1.2" strokeLinecap="round"/>
                </symbol>
                {/* Coin / euro icon */}
                <symbol id="ic-coin" viewBox="0 0 32 32">
                  <circle cx="16" cy="16" r="13" stroke="#CC8844" strokeWidth="1.8" fill="none"/>
                  <circle cx="16" cy="16" r="9" stroke="#CC8844" strokeWidth="1" fill="none"/>
                  <text x="16" y="21" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#CC8844">$</text>
                </symbol>
                {/* Wallet icon */}
                <symbol id="ic-wallet" viewBox="0 0 32 32">
                  <rect x="2" y="9" width="28" height="18" rx="3" stroke="#CC8844" strokeWidth="1.8" fill="none"/>
                  <line x1="2" y1="14" x2="30" y2="14" stroke="#CC8844" strokeWidth="1.5"/>
                  <rect x="19" y="17" width="9" height="5" rx="1.5" fill="#CC8844"/>
                  <path d="M7 6 Q16 3 25 6" stroke="#CC8844" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                </symbol>
                {/* Invoice / receipt icon */}
                <symbol id="ic-invoice" viewBox="0 0 32 32">
                  <rect x="6" y="2" width="20" height="28" rx="2" stroke="#CC8844" strokeWidth="1.8" fill="none"/>
                  <line x1="10" y1="9" x2="22" y2="9" stroke="#CC8844" strokeWidth="1.2" strokeLinecap="round"/>
                  <line x1="10" y1="14" x2="22" y2="14" stroke="#CC8844" strokeWidth="1.2" strokeLinecap="round"/>
                  <line x1="10" y1="19" x2="18" y2="19" stroke="#CC8844" strokeWidth="1.2" strokeLinecap="round"/>
                  <line x1="10" y1="24" x2="16" y2="24" stroke="#CC8844" strokeWidth="1" strokeLinecap="round"/>
                </symbol>
                {/* Calculator icon */}
                <symbol id="ic-calc" viewBox="0 0 32 32">
                  <rect x="5" y="2" width="22" height="28" rx="3" stroke="#CC8844" strokeWidth="1.8" fill="none"/>
                  <rect x="8" y="5" width="16" height="7" rx="1.5" fill="#CC8844" opacity="0.35"/>
                  <circle cx="11" cy="19" r="2" fill="#CC8844"/>
                  <circle cx="16" cy="19" r="2" fill="#CC8844"/>
                  <circle cx="21" cy="19" r="2" fill="#CC8844"/>
                  <circle cx="11" cy="26" r="2" fill="#CC8844"/>
                  <circle cx="16" cy="26" r="2" fill="#CC8844"/>
                  <rect x="19" y="24" width="4" height="4" rx="1" fill="#FF8C3A"/>
                </symbol>
                {/* Briefcase icon */}
                <symbol id="ic-brief" viewBox="0 0 32 32">
                  <rect x="2" y="10" width="28" height="19" rx="3" stroke="#CC8844" strokeWidth="1.8" fill="none"/>
                  <path d="M11 10 L11 7 Q11 4 16 4 Q21 4 21 7 L21 10" stroke="#CC8844" strokeWidth="1.5" fill="none"/>
                  <line x1="2" y1="19" x2="30" y2="19" stroke="#CC8844" strokeWidth="1.2"/>
                  <line x1="16" y1="16" x2="16" y2="22" stroke="#CC8844" strokeWidth="1.5" strokeLinecap="round"/>
                </symbol>
                {/* Document / report icon */}
                <symbol id="ic-doc" viewBox="0 0 32 32">
                  <path d="M6 2 L22 2 L28 8 L28 30 L6 30 Z" stroke="#CC8844" strokeWidth="1.8" fill="none"/>
                  <path d="M22 2 L22 8 L28 8" stroke="#CC8844" strokeWidth="1.5" fill="none"/>
                  <line x1="10" y1="14" x2="22" y2="14" stroke="#CC8844" strokeWidth="1.2" strokeLinecap="round"/>
                  <line x1="10" y1="19" x2="22" y2="19" stroke="#CC8844" strokeWidth="1.2" strokeLinecap="round"/>
                  <line x1="10" y1="24" x2="17" y2="24" stroke="#CC8844" strokeWidth="1.2" strokeLinecap="round"/>
                </symbol>
                {/* Pie chart icon */}
                <symbol id="ic-pie" viewBox="0 0 32 32">
                  <path d="M16 16 L16 3 A13 13 0 0 1 29 16 Z" fill="#CC8844" opacity="0.5"/>
                  <path d="M16 16 L29 16 A13 13 0 1 1 16 3 Z" stroke="#CC8844" strokeWidth="1.5" fill="none"/>
                  <circle cx="16" cy="16" r="13" stroke="#CC8844" strokeWidth="1.5" fill="none"/>
                </symbol>
                {/* Arrow up trend icon */}
                <symbol id="ic-trend" viewBox="0 0 32 32">
                  <polyline points="2,28 10,18 16,22 24,10 30,6" stroke="#CC8844" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                  <polyline points="22,6 30,6 30,14" stroke="#CC8844" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </symbol>
                {/* Magnifying glass / analysis */}
                <symbol id="ic-search" viewBox="0 0 32 32">
                  <circle cx="13" cy="13" r="9" stroke="#CC8844" strokeWidth="1.8" fill="none"/>
                  <line x1="20" y1="20" x2="29" y2="29" stroke="#CC8844" strokeWidth="2" strokeLinecap="round"/>
                  <line x1="9" y1="13" x2="17" y2="13" stroke="#CC8844" strokeWidth="1.2" strokeLinecap="round"/>
                  <line x1="13" y1="9" x2="13" y2="17" stroke="#CC8844" strokeWidth="1.2" strokeLinecap="round"/>
                </symbol>
                {/* Shield / security */}
                <symbol id="ic-shield" viewBox="0 0 32 32">
                  <path d="M16 2 L28 7 L28 17 Q28 26 16 30 Q4 26 4 17 L4 7 Z" stroke="#CC8844" strokeWidth="1.8" fill="none"/>
                  <path d="M10 16 L14 20 L22 12" stroke="#CC8844" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </symbol>
                {/* Percent / discount */}
                <symbol id="ic-pct" viewBox="0 0 32 32">
                  <circle cx="9" cy="9" r="4" stroke="#CC8844" strokeWidth="1.5" fill="none"/>
                  <circle cx="23" cy="23" r="4" stroke="#CC8844" strokeWidth="1.5" fill="none"/>
                  <line x1="5" y1="27" x2="27" y2="5" stroke="#CC8844" strokeWidth="1.5" strokeLinecap="round"/>
                </symbol>
              </defs>

              {/* Icon placements – rows × cols grid, staggered, varied sizes and opacity */}
              {/* Row 1 */}
              <use href="#ic-bar"    x="2%"  y="2%"  width="36" height="36" opacity="0.055"/>
              <use href="#ic-coin"   x="12%" y="1%"  width="28" height="28" opacity="0.04"/>
              <use href="#ic-doc"    x="22%" y="3%"  width="30" height="30" opacity="0.05"/>
              <use href="#ic-trend"  x="33%" y="1%"  width="26" height="26" opacity="0.045"/>
              <use href="#ic-calc"   x="43%" y="2%"  width="34" height="34" opacity="0.05"/>
              <use href="#ic-brief"  x="55%" y="0%"  width="30" height="30" opacity="0.04"/>
              <use href="#ic-invoice" x="65%" y="3%" width="28" height="28" opacity="0.055"/>
              <use href="#ic-pie"    x="76%" y="1%"  width="32" height="32" opacity="0.04"/>
              <use href="#ic-line"   x="87%" y="2%"  width="36" height="36" opacity="0.05"/>

              {/* Row 2 */}
              <use href="#ic-shield" x="6%"  y="10%" width="28" height="28" opacity="0.04"/>
              <use href="#ic-wallet" x="17%" y="9%"  width="34" height="34" opacity="0.055"/>
              <use href="#ic-pct"    x="29%" y="11%" width="26" height="26" opacity="0.04"/>
              <use href="#ic-search" x="39%" y="8%"  width="30" height="30" opacity="0.05"/>
              <use href="#ic-bar"    x="50%" y="10%" width="28" height="28" opacity="0.045"/>
              <use href="#ic-coin"   x="61%" y="9%"  width="36" height="36" opacity="0.05"/>
              <use href="#ic-doc"    x="72%" y="11%" width="26" height="26" opacity="0.04"/>
              <use href="#ic-trend"  x="83%" y="8%"  width="32" height="32" opacity="0.055"/>

              {/* Row 3 */}
              <use href="#ic-invoice" x="1%"  y="19%" width="32" height="32" opacity="0.05"/>
              <use href="#ic-line"    x="11%" y="18%" width="28" height="28" opacity="0.04"/>
              <use href="#ic-brief"   x="22%" y="20%" width="36" height="36" opacity="0.055"/>
              <use href="#ic-pie"     x="33%" y="18%" width="26" height="26" opacity="0.04"/>
              <use href="#ic-calc"    x="44%" y="19%" width="30" height="30" opacity="0.045"/>
              <use href="#ic-shield"  x="55%" y="18%" width="28" height="28" opacity="0.05"/>
              <use href="#ic-bar"     x="65%" y="20%" width="34" height="34" opacity="0.055"/>
              <use href="#ic-wallet"  x="77%" y="18%" width="28" height="28" opacity="0.04"/>
              <use href="#ic-pct"     x="88%" y="19%" width="30" height="30" opacity="0.05"/>

              {/* Row 4 */}
              <use href="#ic-trend"  x="5%"  y="28%" width="30" height="30" opacity="0.045"/>
              <use href="#ic-search" x="16%" y="27%" width="26" height="26" opacity="0.04"/>
              <use href="#ic-coin"   x="27%" y="29%" width="34" height="34" opacity="0.055"/>
              <use href="#ic-doc"    x="38%" y="27%" width="28" height="28" opacity="0.04"/>
              <use href="#ic-invoice" x="49%" y="28%" width="32" height="32" opacity="0.05"/>
              <use href="#ic-line"   x="60%" y="27%" width="30" height="30" opacity="0.045"/>
              <use href="#ic-brief"  x="71%" y="29%" width="26" height="26" opacity="0.04"/>
              <use href="#ic-pie"    x="82%" y="27%" width="36" height="36" opacity="0.055"/>

              {/* Row 5 */}
              <use href="#ic-calc"   x="2%"  y="37%" width="28" height="28" opacity="0.04"/>
              <use href="#ic-bar"    x="13%" y="36%" width="32" height="32" opacity="0.055"/>
              <use href="#ic-shield" x="24%" y="38%" width="30" height="30" opacity="0.045"/>
              <use href="#ic-wallet" x="35%" y="36%" width="26" height="26" opacity="0.04"/>
              <use href="#ic-trend"  x="46%" y="37%" width="34" height="34" opacity="0.05"/>
              <use href="#ic-pct"    x="57%" y="36%" width="28" height="28" opacity="0.055"/>
              <use href="#ic-search" x="68%" y="38%" width="30" height="30" opacity="0.04"/>
              <use href="#ic-coin"   x="79%" y="36%" width="26" height="26" opacity="0.045"/>
              <use href="#ic-doc"    x="90%" y="37%" width="32" height="32" opacity="0.05"/>

              {/* Row 6 */}
              <use href="#ic-invoice" x="7%"  y="46%" width="30" height="30" opacity="0.05"/>
              <use href="#ic-line"    x="18%" y="45%" width="34" height="34" opacity="0.04"/>
              <use href="#ic-pie"     x="29%" y="47%" width="28" height="28" opacity="0.055"/>
              <use href="#ic-brief"   x="40%" y="45%" width="26" height="26" opacity="0.04"/>
              <use href="#ic-bar"     x="51%" y="46%" width="30" height="30" opacity="0.045"/>
              <use href="#ic-calc"    x="62%" y="45%" width="36" height="36" opacity="0.05"/>
              <use href="#ic-shield"  x="73%" y="47%" width="28" height="28" opacity="0.04"/>
              <use href="#ic-trend"   x="84%" y="45%" width="32" height="32" opacity="0.055"/>

              {/* Row 7 */}
              <use href="#ic-coin"   x="3%"  y="55%" width="34" height="34" opacity="0.05"/>
              <use href="#ic-wallet" x="14%" y="54%" width="28" height="28" opacity="0.045"/>
              <use href="#ic-doc"    x="25%" y="56%" width="26" height="26" opacity="0.04"/>
              <use href="#ic-pct"    x="36%" y="54%" width="32" height="32" opacity="0.055"/>
              <use href="#ic-search" x="47%" y="55%" width="30" height="30" opacity="0.04"/>
              <use href="#ic-invoice" x="58%" y="54%" width="28" height="28" opacity="0.05"/>
              <use href="#ic-line"   x="69%" y="56%" width="34" height="34" opacity="0.045"/>
              <use href="#ic-pie"    x="80%" y="54%" width="26" height="26" opacity="0.04"/>
              <use href="#ic-brief"  x="91%" y="55%" width="30" height="30" opacity="0.055"/>

              {/* Row 8 */}
              <use href="#ic-trend"  x="8%"  y="64%" width="28" height="28" opacity="0.04"/>
              <use href="#ic-bar"    x="19%" y="63%" width="36" height="36" opacity="0.055"/>
              <use href="#ic-calc"   x="30%" y="65%" width="28" height="28" opacity="0.045"/>
              <use href="#ic-shield" x="41%" y="63%" width="30" height="30" opacity="0.04"/>
              <use href="#ic-wallet" x="52%" y="64%" width="26" height="26" opacity="0.05"/>
              <use href="#ic-coin"   x="63%" y="63%" width="34" height="34" opacity="0.055"/>
              <use href="#ic-doc"    x="74%" y="65%" width="28" height="28" opacity="0.04"/>
              <use href="#ic-pct"    x="85%" y="63%" width="32" height="32" opacity="0.05"/>

              {/* Row 9 */}
              <use href="#ic-invoice" x="4%"  y="73%" width="32" height="32" opacity="0.055"/>
              <use href="#ic-search"  x="15%" y="72%" width="28" height="28" opacity="0.04"/>
              <use href="#ic-line"    x="26%" y="74%" width="30" height="30" opacity="0.05"/>
              <use href="#ic-brief"   x="37%" y="72%" width="34" height="34" opacity="0.045"/>
              <use href="#ic-bar"     x="48%" y="73%" width="26" height="26" opacity="0.04"/>
              <use href="#ic-pie"     x="59%" y="72%" width="30" height="30" opacity="0.055"/>
              <use href="#ic-trend"   x="70%" y="74%" width="28" height="28" opacity="0.04"/>
              <use href="#ic-calc"    x="81%" y="72%" width="36" height="36" opacity="0.05"/>
              <use href="#ic-shield"  x="92%" y="73%" width="26" height="26" opacity="0.045"/>

              {/* Row 10 */}
              <use href="#ic-wallet" x="1%"  y="82%" width="30" height="30" opacity="0.05"/>
              <use href="#ic-coin"   x="12%" y="81%" width="26" height="26" opacity="0.045"/>
              <use href="#ic-doc"    x="23%" y="83%" width="34" height="34" opacity="0.04"/>
              <use href="#ic-pct"    x="34%" y="81%" width="28" height="28" opacity="0.055"/>
              <use href="#ic-search" x="45%" y="82%" width="32" height="32" opacity="0.04"/>
              <use href="#ic-invoice" x="56%" y="81%" width="26" height="26" opacity="0.05"/>
              <use href="#ic-line"    x="67%" y="83%" width="30" height="30" opacity="0.045"/>
              <use href="#ic-brief"   x="78%" y="81%" width="28" height="28" opacity="0.04"/>
              <use href="#ic-bar"     x="89%" y="82%" width="34" height="34" opacity="0.055"/>

              {/* Row 11 */}
              <use href="#ic-pie"    x="6%"  y="91%" width="26" height="26" opacity="0.04"/>
              <use href="#ic-trend"  x="17%" y="90%" width="32" height="32" opacity="0.055"/>
              <use href="#ic-calc"   x="28%" y="92%" width="28" height="28" opacity="0.045"/>
              <use href="#ic-shield" x="39%" y="90%" width="30" height="30" opacity="0.04"/>
              <use href="#ic-coin"   x="50%" y="91%" width="34" height="34" opacity="0.05"/>
              <use href="#ic-wallet" x="61%" y="90%" width="26" height="26" opacity="0.055"/>
              <use href="#ic-doc"    x="72%" y="92%" width="30" height="30" opacity="0.04"/>
              <use href="#ic-pct"    x="83%" y="90%" width="28" height="28" opacity="0.045"/>
              <use href="#ic-search" x="94%" y="91%" width="32" height="32" opacity="0.05"/>
            </svg>
          </div>

          {/* Content above background */}
          <div ref={messagesInnerRef} className="relative pb-24 sm:pb-4" style={{ zIndex: 1 }}>
            {historyLoading && (
              <div className="flex flex-col items-center justify-center gap-4 px-4 py-10">
                <div className="flex gap-1.5 items-center">
                  {[0, 150, 300].map((delay, i) => (
                    <span
                      key={i}
                      className="w-2.5 h-2.5 rounded-full animate-bounce"
                      style={{ animationDelay: `${delay}ms`, backgroundColor: '#FF6B00', opacity: 0.7 }}
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
                />
              ))}
            </AnimatePresence>
            <AnimatePresence>
              {loading && <TypingIndicator key="typing" />}
            </AnimatePresence>
            <div ref={messagesEndRef} aria-hidden="true" style={{ height: 1, scrollMarginBottom: 24 }} />
          </div>
        </div>

        {/* ── Input bar ── */}
        <div
          className="flex-shrink-0 px-4 pt-2 flex items-end gap-3"
          style={{
            backgroundColor: '#F5F1EB',
            borderTop: '1px solid rgba(0,0,0,0.06)',
            paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
          }}
        >
          <div className="flex-1 bg-white rounded-3xl shadow-sm overflow-hidden flex items-end px-4 py-2.5 border border-gray-100" style={{ minHeight: 44 }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onFocus={handleTextareaFocus}
              onKeyDown={handleKeyDown}
              enterKeyHint="enter"
              placeholder={historyLoading ? 'Chargement de l\'historique…' : 'Message…'}
              rows={1}
              disabled={historyLoading}
              className="chat-input w-full resize-none bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none leading-relaxed max-h-36 disabled:opacity-50"
              style={{ minHeight: 22 }}
            />
          </div>

          <AnimatePresence mode="wait">
            {input.trim() ? (
              <motion.button
                key="send"
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.7, opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={submit}
                disabled={loading}
                className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white active:scale-95 transition-transform disabled:opacity-60"
                style={{ backgroundColor: '#FF6B00', boxShadow: '0 2px 8px rgba(255,107,0,0.4)' }}
                aria-label="Envoyer"
              >
                <Send style={{ width: 18, height: 18 }} strokeWidth={2.5} />
              </motion.button>
            ) : (
              <div key="spacer" className="w-11 h-11 flex-shrink-0" />
            )}
          </AnimatePresence>
        </div>

      </div>

      {/* ── Side drawer ── */}
      <SideDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onLogout={handleLogout}
        onNavigate={(route) => navigate(route)}
        onGuide={() => {
          if (user?.id) persistRelaunchGuide(user.id);
        }}
        user={user}
      />

      {/* ── Support chat widget ── */}
      <SupportChatWidget user={user} forceOpen={isPending || isActive} />
    </>
  );
}
