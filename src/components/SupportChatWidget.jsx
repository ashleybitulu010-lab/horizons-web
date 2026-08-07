import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, ChevronDown } from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import Ashy from '@/components/Ashy';
import EmojiText from '@/components/EmojiText';
import { useChat } from '@/context/ChatContext';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  useOnboarding,
  WELCOME_ONBOARDING,
  ORDER_RULE_MESSAGE,
  ORDER_BLOCK_MESSAGE,
  ONE_DATA_REMINDER,
  ONBOARDING_STEPS,
  ONBOARDING_RELAUNCH_EVENT,
} from '@/hooks/useOnboarding';
import {
  checkOnboardingStep,
  detectPrematureSale,
  snapshotOnboardingBaselines,
} from '@/lib/onboardingChecks';
import { localAshyReply, escalateToTelegramSupport } from '@/lib/ashyAssistant';
import { readStoredCurrencyPreference } from '@/lib/currency';
import {
  compactSpacedDigits,
  normalizeChatIcons,
  normalizeMessageText,
} from '@/lib/textEncoding';
import { trackChatMessageSent, trackFromAssistantReply } from '@/lib/analytics';

const SUPPORT_AVATAR = 'https://horizons-cdn.hostinger.com/29358ba6-568b-49c6-9aac-6ece4b30fac6/ca8bd733c63d36fa2caff0db62fb3057.png';

const TOOLTIPS = ['👋 Besoin d\'aide ?', '💬 Discutez avec Ashy', '🎯 Relancer le guide ?'];
const BUBBLE_SIZE = 80;
const MARGIN = 28;
const LS_KEY = 'ash_support_bubble_pos';

function getTime(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function ReadTicks({ isRead }) {
  return (
    <span className="inline-flex items-center ml-0.5">
      <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
        <path d="M1 5L4 8L11 1" stroke={isRead ? '#93C5FD' : 'rgba(255,255,255,0.75)'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 5L8 8L15 1" stroke={isRead ? '#93C5FD' : 'rgba(255,255,255,0.75)'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function clampPos(x, y) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    x: Math.max(MARGIN, Math.min(vw - BUBBLE_SIZE - MARGIN, x)),
    y: Math.max(MARGIN, Math.min(vh - BUBBLE_SIZE - MARGIN, y)),
  };
}

function getDefaultPos() {
  return { x: window.innerWidth - BUBBLE_SIZE - MARGIN, y: window.innerHeight - BUBBLE_SIZE - MARGIN };
}

function loadPos() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const pos = JSON.parse(raw);
    if (typeof pos.x === 'number' && typeof pos.y === 'number') return clampPos(pos.x, pos.y);
  } catch (_) { /* ignore */ }
  return null;
}

function savePos(pos) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(pos)); } catch (_) { /* ignore */ }
}

function snapToEdge(x, y) {
  const midX = window.innerWidth / 2;
  const snappedX = x < midX ? MARGIN : window.innerWidth - BUBBLE_SIZE - MARGIN;
  return clampPos(snappedX, y);
}

function avoidCriticalZones(x, y) {
  const zone = { x: 0, y: window.innerHeight - 100, w: window.innerWidth, h: 100 };
  const bubbleRect = { x, y, w: BUBBLE_SIZE, h: BUBBLE_SIZE };
  const overlap =
    bubbleRect.x < zone.x + zone.w &&
    bubbleRect.x + bubbleRect.w > zone.x &&
    bubbleRect.y < zone.y + zone.h &&
    bubbleRect.y + bubbleRect.h > zone.y;
  if (overlap) y = zone.y - BUBBLE_SIZE - MARGIN;
  return clampPos(x, y);
}

function makeLocalMsg(content, senderType, extras = {}) {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    content,
    sender_type: senderType,
    created: new Date().toISOString(),
    is_read: true,
    local: true,
    ...extras,
  };
}

function ProgressBar({ progress, visible }) {
  if (!visible) return null;
  return (
    <div className="px-4 py-2.5 flex-shrink-0" style={{ backgroundColor: '#FFF4EB', borderBottom: '1px solid rgba(255,107,0,0.12)' }}>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-semibold text-orange-700">
          Étape {progress.step}/{progress.total}
          {progress.label ? ` · ${progress.label}` : ''}
        </p>
        <p className="text-[11px] font-bold text-orange-600 tabular-nums">{progress.percent} %</p>
      </div>
      <div className="h-1.5 rounded-full bg-orange-100 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: '#FF6B00' }}
          initial={false}
          animate={{ width: `${progress.percent}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>
    </div>
  );
}

export default function SupportChatWidget({ user, forceOpen = false }) {
  const { messages: mainMessages, loading: mainLoading } = useChat();
  const isMobile = useIsMobile();
  const bubbleSize = isMobile ? 56 : BUBBLE_SIZE;
  const currencySettings = readStoredCurrencyPreference(user?.id);
  const {
    state: onboarding,
    progress,
    currentStep,
    isGuideMode,
    isActive,
    isPending,
    startGuide,
    skipGuide,
    advanceStep,
    completeGuide,
    restartGuide,
    setBaselines,
  } = useOnboarding(user?.id, user?.created);

  const [open, setOpen] = useState(Boolean(forceOpen));
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [guideMessages, setGuideMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [agentTyping, setAgentTyping] = useState(false);
  const [unread, setUnread] = useState(0);
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipText, setTooltipText] = useState(TOOLTIPS[0]);
  const [newMsgIds, setNewMsgIds] = useState(new Set());
  const [celebrateSignal, setCelebrateSignal] = useState(0);
  const [thinkingSignal, setThinkingSignal] = useState(false);
  const [validating, setValidating] = useState(false);
  const [welcomeShown, setWelcomeShown] = useState(false);

  const [pos, setPos] = useState(() => loadPos() || getDefaultPos());
  const [isDragging, setIsDragging] = useState(false);
  const [snapTransition, setSnapTransition] = useState(false);
  const dragStart = useRef(null);
  const hasMoved = useRef(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const tooltipInterval = useRef(null);
  const replyTimer = useRef(null);
  const advancingRef = useRef(false);
  const prematureWarnedRef = useRef(false);
  const remindCounterRef = useRef(0);
  const autoOpenedRef = useRef(false);

  const showGuideTranscript =
    isGuideMode || (onboarding?.status === 'completed' && guideMessages.length > 0 && messages.length === 0);
  const displayMessages = showGuideTranscript ? guideMessages : messages;

  const pushGuide = useCallback((content, extras = {}) => {
    const msg = makeLocalMsg(content, 'support', extras);
    setGuideMessages((prev) => [...prev, msg]);
    setNewMsgIds((prev) => new Set([...prev, msg.id]));
    return msg;
  }, []);

  const pushGuideUser = useCallback((content) => {
    const msg = makeLocalMsg(content, 'user');
    setGuideMessages((prev) => [...prev, msg]);
    setNewMsgIds((prev) => new Set([...prev, msg.id]));
    return msg;
  }, []);

  const withTyping = useCallback((fn, delay = 900) => {
    clearTimeout(replyTimer.current);
    setAgentTyping(true);
    setThinkingSignal(true);
    replyTimer.current = setTimeout(() => {
      setAgentTyping(false);
      setThinkingSignal(false);
      fn();
    }, delay);
  }, []);

  // Auto-open once for new / relaunched guide (also ?guide=1 from Settings)
  useEffect(() => {
    if (!user?.id) return;
    const forceGuide =
      forceOpen ||
      (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('guide') === '1');
    if ((isPending || forceGuide) && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setOpen(true);
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('guide') === '1' && window.history?.replaceState) {
        const url = new URL(window.location.href);
        url.searchParams.delete('guide');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      }
    }
  }, [user?.id, isPending, forceOpen]);

  // Seed welcome when pending
  useEffect(() => {
    if (!isPending || welcomeShown) return;
    setGuideMessages([
      makeLocalMsg(WELCOME_ONBOARDING.content, 'support', {
        id: WELCOME_ONBOARDING.id,
        actions: WELCOME_ONBOARDING.actions,
      }),
    ]);
    setWelcomeShown(true);
  }, [isPending, welcomeShown]);

  // Resume active guide UI if panel reopens with empty local transcript
  useEffect(() => {
    if (!isActive || !currentStep || guideMessages.length > 0) return;
    setGuideMessages([
      makeLocalMsg(
        `On reprend là où nous nous sommes arrêtés.\n\nÉtape ${currentStep.index}/5 — ${currentStep.title}\n\n${currentStep.explain}\n\n${ONE_DATA_REMINDER}`,
        'support',
      ),
    ]);
  }, [isActive, currentStep, guideMessages.length]);

  // Relaunch from Settings / menu (widget already mounted on ChatPage)
  useEffect(() => {
    const onRelaunch = () => {
      restartGuide();
      setWelcomeShown(false);
      setGuideMessages([]);
      advancingRef.current = false;
      prematureWarnedRef.current = false;
      remindCounterRef.current = 0;
      autoOpenedRef.current = false;
      setOpen(true);
      // Seed immediately so the user sees the welcome without waiting another tick
      setTimeout(() => {
        setGuideMessages([
          makeLocalMsg(WELCOME_ONBOARDING.content, 'support', {
            id: WELCOME_ONBOARDING.id,
            actions: WELCOME_ONBOARDING.actions,
          }),
        ]);
        setWelcomeShown(true);
        autoOpenedRef.current = true;
      }, 0);
    };
    window.addEventListener(ONBOARDING_RELAUNCH_EVENT, onRelaunch);
    return () => window.removeEventListener(ONBOARDING_RELAUNCH_EVENT, onRelaunch);
  }, [restartGuide]);

  useEffect(() => {
    const onResize = () => {
      setPos((prev) => {
        const clamped = clampPos(prev.x, prev.y);
        savePos(clamped);
        return clamped;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages, agentTyping]);

  useEffect(() => {
    if (open) { setShowTooltip(false); return; }
    const showNext = () => {
      setTooltipText(TOOLTIPS[Math.floor(Math.random() * TOOLTIPS.length)]);
      setShowTooltip(true);
      setTimeout(() => setShowTooltip(false), 3800);
    };
    const initial = setTimeout(showNext, 4000);
    tooltipInterval.current = setInterval(showNext, 22000);
    return () => { clearTimeout(initial); clearInterval(tooltipInterval.current); setShowTooltip(false); };
  }, [open]);

  const initChat = useCallback(async () => {
    if (!user?.id || isGuideMode) return null;
    try {
      const existing = await pb.collection('support_chats').getFirstListItem(
        `owner = "${user.id}" && status = "open"`,
        { requestKey: 'sc-load' },
      );
      setChat(existing);
      const msgs = await pb.collection('support_messages').getFullList({
        filter: `chat = "${existing.id}"`,
        sort: 'created',
        requestKey: 'sm-load',
      });
      setMessages(msgs);
      return existing;
    } catch (_) {
      try {
        const newChat = await pb.collection('support_chats').create({
          owner: user.id, status: 'open', unread_count: 0,
        }, { requestKey: 'sc-create' });
        setChat(newChat);
        const welcome = await pb.collection('support_messages').create({
          chat: newChat.id,
          content: "👋 Bonjour ! Je suis Ashy, votre assistant financier.\nComment puis-je vous aider aujourd'hui ?",
          sender_type: 'support',
          is_read: false,
        }, { requestKey: 'sm-welcome' });
        setMessages([welcome]);
        return newChat;
      } catch (err) {
        console.error('Support chat init error', err);
        return null;
      }
    }
  }, [user?.id, isGuideMode]);

  useEffect(() => {
    if (open && user?.id && !isGuideMode && !chat?.id) {
      void initChat();
    }
  }, [open, user?.id, initChat, isGuideMode, chat?.id]);

  useEffect(() => {
    if (!chat?.id || isGuideMode) return;
    void pb.collection('support_messages').subscribe('*', (e) => {
      if (e.record.chat !== chat.id) return;
      if (e.action === 'create') {
        setMessages((prev) => {
          if (prev.find((m) => m.id === e.record.id)) return prev;
          return [...prev, e.record];
        });
        setNewMsgIds((prev) => new Set([...prev, e.record.id]));
        if (!open && e.record.sender_type === 'support') setUnread((n) => n + 1);
      }
    }, { requestKey: 'sc-realtime' }).catch(() => {});
    return () => { void pb.collection('support_messages').unsubscribe('*').catch(() => {}); };
  }, [chat?.id, open, isGuideMode]);

  useEffect(() => { if (open) setUnread(0); }, [open]);

  // Capture baselines once (non-blocking for chat-based validation).
  useEffect(() => {
    if (!isActive || !user?.id || onboarding?.baselines) return undefined;
    let cancelled = false;
    (async () => {
      const baselines = await snapshotOnboardingBaselines(user);
      if (!cancelled) setBaselines(baselines);
    })();
    return () => { cancelled = true; };
  }, [isActive, user, onboarding?.baselines, setBaselines]);

  const completeCurrentStep = useCallback((stepSnapshot, fromIndex) => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    setValidating(true);
    withTyping(() => {
      pushGuide(stepSnapshot.success);
      setCelebrateSignal((s) => s + 1);

      const nextIndex = (fromIndex || 0) + 1;
      if (nextIndex >= ONBOARDING_STEPS.length) {
        completeGuide();
        setValidating(false);
        setTimeout(() => {
          pushGuide('Je reste disponible ici pour vos questions. Le chat principal sert à enregistrer vos opérations.');
          advancingRef.current = false;
        }, 700);
        return;
      }

      advanceStep();
      const next = ONBOARDING_STEPS[nextIndex];
      remindCounterRef.current += 1;
      const reminder = remindCounterRef.current % 2 === 0 ? `\n\n${ONE_DATA_REMINDER}` : '';
      setTimeout(() => {
        withTyping(() => {
          pushGuide(`Étape ${next.index}/5 — ${next.title}\n\n${next.explain}${reminder}`);
          advancingRef.current = false;
          prematureWarnedRef.current = false;
          setValidating(false);
        }, 700);
      }, 500);
    }, 500);
  }, [advanceStep, completeGuide, pushGuide, withTyping]);

  // Validate onboarding steps against main chat / Supabase
  useEffect(() => {
    if (!isActive || !currentStep || advancingRef.current) return undefined;

    let cancelled = false;

    const run = async () => {
      if (advancingRef.current || cancelled) return;

      if (detectPrematureSale(onboarding.stepIndex, mainMessages) && !prematureWarnedRef.current) {
        prematureWarnedRef.current = true;
        withTyping(() => pushGuide(ORDER_BLOCK_MESSAGE), 600);
      }

      // While Ash is typing in the main chat, wait for the reply then re-check.
      if (mainLoading) return;

      try {
        const ok = await checkOnboardingStep(currentStep.check, user, mainMessages, {
          baselines: onboarding?.baselines || null,
        });
        if (cancelled || !ok || advancingRef.current) return;
        completeCurrentStep(currentStep, onboarding.stepIndex || 0);
      } catch {
        if (!cancelled) setValidating(false);
      }
    };

    run();
    const id = setInterval(run, mainLoading ? 1200 : 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    isActive,
    currentStep,
    onboarding?.stepIndex,
    onboarding?.baselines,
    mainMessages,
    mainLoading,
    user,
    completeCurrentStep,
    pushGuide,
    withTyping,
  ]);

  const handleManualValidate = useCallback(() => {
    if (!isActive || !currentStep || advancingRef.current) return;
    completeCurrentStep(currentStep, onboarding?.stepIndex || 0);
  }, [isActive, currentStep, onboarding?.stepIndex, completeCurrentStep]);

  const onPointerDown = useCallback((e) => {
    if (isMobile) {
      hasMoved.current = false;
      return;
    }
    e.preventDefault();
    hasMoved.current = false;
    dragStart.current = { clientX: e.clientX, clientY: e.clientY, bx: pos.x, by: pos.y };
    setIsDragging(true);
    setSnapTransition(false);
  }, [isMobile, pos]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e) => {
      const client = e.touches ? e.touches[0] : e;
      const dx = client.clientX - dragStart.current.clientX;
      const dy = client.clientY - dragStart.current.clientY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasMoved.current = true;
      setPos(clampPos(dragStart.current.bx + dx, dragStart.current.by + dy));
    };
    const onUp = (e) => {
      setIsDragging(false);
      setSnapTransition(true);
      setTimeout(() => setSnapTransition(false), 500);
      setPos(() => {
        const client = e.changedTouches ? e.changedTouches[0] : e;
        const dx = client.clientX - dragStart.current.clientX;
        const dy = client.clientY - dragStart.current.clientY;
        const raw = clampPos(dragStart.current.bx + dx, dragStart.current.by + dy);
        const snapped = snapToEdge(raw.x, raw.y);
        const finalPos = avoidCriticalZones(snapped.x, snapped.y);
        savePos(finalPos);
        return finalPos;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [isDragging]);

  const handleBubbleClick = useCallback(() => {
    if (hasMoved.current) return;
    setOpen(true);
    setShowTooltip(false);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleStartGuide = useCallback(() => {
    setGuideMessages((prev) =>
      prev.map((m) => (m.id === WELCOME_ONBOARDING.id ? { ...m, actions: undefined } : m)),
    );
    // Start immediately — chat validation works without baselines.
    // Real baselines arrive async so Supabase growth checks don't auto-skip old data.
    startGuide({ baselines: null });
    void snapshotOnboardingBaselines(user).then((baselines) => {
      if (baselines) setBaselines(baselines);
    });
    withTyping(() => {
      pushGuide(ORDER_RULE_MESSAGE);
      setTimeout(() => {
        withTyping(() => {
          const step = ONBOARDING_STEPS[0];
          pushGuide(`Étape ${step.index}/5 — ${step.title}\n\n${step.explain}\n\n${ONE_DATA_REMINDER}`);
        }, 800);
      }, 400);
    }, 700);
  }, [startGuide, pushGuide, withTyping, user, setBaselines]);

  const handleLaterGuide = useCallback(() => {
    setGuideMessages((prev) =>
      prev.map((m) => (m.id === WELCOME_ONBOARDING.id ? { ...m, actions: undefined } : m)),
    );
    pushGuide('D’accord. Réduisez Ashy quand vous voulez — le guide reste disponible via Paramètres → Guide Ashy.');
    setTimeout(() => setOpen(false), 900);
  }, [pushGuide]);

  const handleSkipGuide = useCallback(() => {
    skipGuide();
    setGuideMessages((prev) =>
      prev.map((m) => (m.id === WELCOME_ONBOARDING.id ? { ...m, actions: undefined } : m)),
    );
    withTyping(() => {
      pushGuide('Pas de souci. Vous pourrez relancer le guide à tout moment dans Paramètres → Guide Ashy.');
      setTimeout(() => setOpen(false), 1600);
    }, 600);
  }, [skipGuide, pushGuide, withTyping]);

  // Small bottom-right popup — never covers the full chat.
  const getPanelStyle = () => {
    const vh = typeof window !== 'undefined' ? window.innerHeight : 700;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 400;
    const side = isMobile ? 12 : 20;
    const bubbleClearance = (isMobile ? 56 : BUBBLE_SIZE) + 12;
    const panelW = isMobile
      ? Math.min(300, vw - 72)
      : Math.min(340, vw - 80);
    const panelH = isMobile
      ? Math.min(480, Math.round(vh * 0.58))
      : Math.min(500, Math.round(vh * 0.54));

    return {
      position: 'fixed',
      left: 'auto',
      right: side,
      top: 'auto',
      bottom: `calc(${bubbleClearance}px + env(safe-area-inset-bottom, 0px))`,
      width: panelW,
      height: panelH,
      maxWidth: 'calc(100vw - 72px)',
      maxHeight: isMobile ? '58vh' : '54vh',
      zIndex: 99,
    };
  };

  const sendGuideMessage = async (text) => {
    pushGuideUser(text);
    withTyping(() => {
      if (detectPrematureSale(onboarding?.stepIndex ?? 0, [{ role: 'user', content: text }, ...mainMessages])) {
        pushGuide(ORDER_BLOCK_MESSAGE);
        return;
      }
      if (/vente|vendu/i.test(text) && (onboarding?.stepIndex ?? 0) < 2) {
        pushGuide(ORDER_BLOCK_MESSAGE);
        return;
      }
      pushGuide(
        currentStep
          ? `Je vous guide encore sur « ${currentStep.title} ».\nRéalisez l'action dans le chat principal, puis je vérifierai automatiquement.\n\n${ONE_DATA_REMINDER}`
          : 'Utilisez les boutons du guide ou le chat principal pour avancer.',
      );
    }, 700);
  };

  const sendNormalMessage = async (text) => {
    const activeChat = chat?.id ? chat : await initChat();
    const decision = localAshyReply(text);

    if (!activeChat) {
      const localUser = makeLocalMsg(text, 'user');
      setMessages((prev) => [...prev, localUser]);
      withTyping(() => {
        const reply = makeLocalMsg(decision.reply, 'support');
        setMessages((prev) => [...prev, reply]);
        setNewMsgIds((prev) => new Set([...prev, reply.id]));
        trackFromAssistantReply(decision.reply);
        if (decision.type === 'escalate') {
          void escalateToTelegramSupport({ user, message: text, chatId: '' });
        }
      }, 900);
      return;
    }

    try {
      const msg = await pb.collection('support_messages').create({
        chat: activeChat.id, content: text, sender_type: 'user', is_read: false,
      });
      setMessages((prev) => [...prev, msg]);
      setNewMsgIds((prev) => new Set([...prev, msg.id]));
      setCelebrateSignal((s) => s + 1);

      withTyping(async () => {
        try {
          const reply = await pb.collection('support_messages').create({
            chat: activeChat.id,
            content: decision.reply,
            sender_type: 'support',
            is_read: false,
          });
          setMessages((prev) => [...prev, reply]);
          setNewMsgIds((prev) => new Set([...prev, reply.id]));
        } catch (_) {
          const local = makeLocalMsg(decision.reply, 'support');
          setMessages((prev) => [...prev, local]);
        }
        trackFromAssistantReply(decision.reply);

        // Human / Telegram escalation only outside tutorial
        if (decision.type === 'escalate') {
          await escalateToTelegramSupport({
            user,
            message: text,
            chatId: activeChat.id,
          });
        }
      }, 1000 + Math.random() * 600);
    } catch (err) {
      console.error('Failed to send support message', err);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setSending(true);
    trackChatMessageSent(isGuideMode ? 'guide' : 'support_widget');
    try {
      if (isGuideMode) await sendGuideMessage(text);
      else await sendNormalMessage(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (
      e.key === 'Enter'
      && !e.shiftKey
      && (e.ctrlKey || e.metaKey)
      && !e.nativeEvent?.isComposing
    ) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleTextarea = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 88) + 'px';
  };

  const headerTitle = isGuideMode ? 'Ashy · Guide interactif' : 'Ashy';
  const headerSub = isGuideMode
    ? (validating ? 'Vérification en cours…' : 'Je vous accompagne pas à pas')
    : 'Assistant financier · En ligne';

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="support-panel"
            data-support-panel
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            style={getPanelStyle()}
            className="support-panel-mobile rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          >
            <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ backgroundColor: '#FF6B00' }}>
              <div className="relative flex-shrink-0">
                <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-white/40">
                  <img src={SUPPORT_AVATAR} alt="Ashy" className="w-full h-full object-cover" />
                </div>
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-orange-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm leading-tight">{headerTitle}</p>
                <p className="text-orange-100 text-[11px] mt-0.5">{headerSub}</p>
              </div>
              {isGuideMode && (
                <button
                  type="button"
                  onClick={handleSkipGuide}
                  className="mr-1 rounded-full px-2 py-1 text-[10px] font-semibold text-white/90 hover:bg-white/15"
                >
                  Passer
                </button>
              )}
              <button
                onClick={handleClose}
                className="w-7 h-7 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/15 transition-colors"
                aria-label="Réduire"
              >
                <ChevronDown size={18} />
              </button>
            </div>

            <ProgressBar progress={progress} visible={isActive} />

            {isActive && currentStep && (
              <div
                className="flex-shrink-0 px-3 py-2 border-b"
                style={{ backgroundColor: '#FFF8F2', borderColor: 'rgba(255,107,0,0.15)' }}
              >
                <button
                  type="button"
                  onClick={handleManualValidate}
                  disabled={validating}
                  className="w-full rounded-xl px-3 py-2 text-xs font-bold text-white active:scale-[0.98] disabled:opacity-60"
                  style={{ backgroundColor: '#FF6B00' }}
                >
                  {validating ? 'Validation…' : `✅ J’ai terminé : ${currentStep.title}`}
                </button>
                <p className="mt-1 text-[10px] text-stone-500 leading-snug">
                  Faites l’action dans le chat principal, puis appuyez ici si Ashy ne passe pas à l’étape suivante.
                </p>
              </div>
            )}

            <div
              className="flex-1 overflow-y-auto py-3 px-3 space-y-1.5"
              style={{
                backgroundColor: '#EDE8E0',
                backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Cpath d='M 5 25 Q 15 15 25 25 Q 35 35 45 25 Q 55 15 65 25' stroke='%23c8b89a' stroke-width='0.5' fill='none' opacity='0.2'/%3E%3C/svg%3E\")",
                backgroundSize: '60px 60px',
              }}
            >
              <AnimatePresence initial={false}>
                {displayMessages.map((msg) => {
                  const isUser = msg.sender_type === 'user';
                  const isNew = newMsgIds.has(msg.id);
                  return (
                    <motion.div
                      key={msg.id}
                      initial={isNew ? { opacity: 0, y: 8, scale: 0.97 } : false}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      className={`flex items-end gap-1.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                    >
                      {!isUser && (
                        <div className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0 mb-1 border border-white/60">
                          <img src={SUPPORT_AVATAR} alt="Ashy" className="w-full h-full object-cover" />
                        </div>
                      )}
                      <div
                        className={`max-w-[85%] px-3 py-2 shadow-sm text-sm leading-relaxed whitespace-pre-wrap break-words ${
                          isUser
                            ? 'rounded-2xl rounded-br-sm text-white'
                            : 'rounded-2xl rounded-bl-sm text-gray-800 bg-white'
                        }`}
                        style={isUser ? { backgroundColor: '#FF6B00' } : {}}
                      >
                        <span className="chat-text">
                          <EmojiText>
                            {compactSpacedDigits(
                              isUser
                                ? normalizeChatIcons(msg.content)
                                : normalizeMessageText(msg.content, currencySettings),
                            )}
                          </EmojiText>
                        </span>
                        {Array.isArray(msg.actions) && msg.actions.length > 0 && (
                          <div className="mt-3 flex flex-col gap-2">
                            {msg.actions.map((action) => (
                              <button
                                key={action.id}
                                type="button"
                                onClick={() => {
                                  if (action.id === 'start') handleStartGuide();
                                  if (action.id === 'later') handleLaterGuide();
                                  if (action.id === 'skip') handleSkipGuide();
                                }}
                                className={`w-full text-sm font-semibold py-2 px-3 rounded-xl transition-all active:scale-[0.98] ${
                                  action.variant === 'ghost'
                                    ? 'bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100'
                                    : 'text-white'
                                }`}
                                style={action.variant === 'ghost' ? undefined : { backgroundColor: '#FF6B00' }}
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center justify-end gap-0.5 mt-0.5">
                          <span
                            dir="ltr"
                            className={`chat-time text-[10px] ${isUser ? 'text-orange-200' : 'text-gray-400'}`}
                          >
                            {getTime(msg.created)}
                          </span>
                          {isUser && <ReadTicks isRead={msg.is_read} />}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              <AnimatePresence>
                {agentTyping && (
                  <motion.div
                    key="typing"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="flex items-end gap-1.5"
                  >
                    <div className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0 border border-white/60">
                      <img src={SUPPORT_AVATAR} alt="Ashy" className="w-full h-full object-cover" />
                    </div>
                    <div className="bg-white rounded-2xl rounded-bl-sm px-3 py-2 shadow-sm">
                      <div className="flex gap-1 items-center" style={{ minWidth: 28 }}>
                        {[0, 160, 320].map((delay, i) => (
                          <span
                            key={i}
                            className="w-1.5 h-1.5 rounded-full animate-bounce"
                            style={{ animationDelay: `${delay}ms`, backgroundColor: '#FF6B00', opacity: 0.7 }}
                          />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>

            <div
              className="flex-shrink-0 px-3 py-2.5 flex items-end gap-2"
              style={{ backgroundColor: '#F0EBE2', borderTop: '1px solid rgba(0,0,0,0.06)' }}
            >
              <div className="flex-1 bg-white rounded-2xl overflow-hidden flex items-end px-3 py-2 border border-gray-100 shadow-sm">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={handleTextarea}
                  onKeyDown={handleKeyDown}
                  enterKeyHint="enter"
                  placeholder={isGuideMode ? 'Posez une question à Ashy…' : 'Votre message…'}
                  rows={1}
                  className="chat-input w-full resize-none bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none leading-relaxed"
                  style={{ minHeight: 20, maxHeight: 88 }}
                />
              </div>
              <motion.button
                onClick={sendMessage}
                disabled={!input.trim() || sending}
                className="w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center text-white transition-opacity"
                whileTap={{ scale: 0.88 }}
                style={{ backgroundColor: '#FF6B00', opacity: (!input.trim() || sending) ? 0.4 : 1 }}
              >
                <Send size={14} strokeWidth={2.2} />
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!open && (
          <motion.div
            key="bubble-wrapper"
            data-support-bubble
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ type: 'spring', damping: 22, stiffness: 300 }}
            style={{
              position: 'fixed',
              ...(isMobile
                ? {
                  right: 12,
                  bottom: 'calc(84px + env(safe-area-inset-bottom))',
                }
                : {
                  left: pos.x,
                  top: pos.y,
                }),
              zIndex: 100,
              touchAction: isMobile ? 'auto' : 'none',
              transition: snapTransition ? 'left 0.4s cubic-bezier(0.34,1.56,0.64,1), top 0.4s cubic-bezier(0.34,1.56,0.64,1)' : undefined,
            }}
            className="support-bubble-mobile flex flex-col items-end gap-2"
          >
            <AnimatePresence>
              {showTooltip && !isDragging && !isMobile && (
                <motion.div
                  key="tooltip"
                  initial={{ opacity: 0, y: 6, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.96 }}
                  transition={{ duration: 0.22 }}
                  className="absolute bottom-full mb-3 right-0 bg-white text-gray-800 text-sm font-medium px-3.5 py-2 rounded-xl shadow-lg border border-gray-100 whitespace-nowrap pointer-events-none"
                >
                  {tooltipText}
                  <span className="absolute -bottom-1.5 right-4 w-3 h-3 bg-white border-r border-b border-gray-100 rotate-45" />
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              onPointerDown={onPointerDown}
              onClick={handleBubbleClick}
              className="relative flex items-center justify-center select-none"
              style={{
                width: bubbleSize,
                height: bubbleSize,
                borderRadius: '50%',
                background: 'transparent',
                border: 'none',
                padding: 0,
                margin: 0,
                boxShadow: 'none',
                cursor: isMobile ? 'pointer' : isDragging ? 'grabbing' : 'grab',
              }}
              whileHover={{ scale: isDragging ? 1 : 1.08 }}
              whileTap={{ scale: 0.91 }}
            >
              <Ashy
                size={isMobile ? 60 : 100}
                onOpenChat={handleBubbleClick}
                celebrateSignal={celebrateSignal}
                thinkingSignal={thinkingSignal}
              />
              <AnimatePresence>
                {unread > 0 && (
                  <motion.span
                    key="badge"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-white text-[10px] font-bold flex items-center justify-center border-2 border-white pointer-events-none"
                  >
                    {unread > 9 ? '9+' : unread}
                  </motion.span>
                )}
              </AnimatePresence>
              {isDragging && (
                <span className="absolute inset-0 rounded-full border-2 border-white/40 animate-ping pointer-events-none" />
              )}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
