import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, ChevronDown } from 'lucide-react';
import pb from '@/lib/pocketbaseClient';
import Ashy from '@/components/Ashy';

const SUPPORT_AVATAR = 'https://horizons-cdn.hostinger.com/29358ba6-568b-49c6-9aac-6ece4b30fac6/ca8bd733c63d36fa2caff0db62fb3057.png';

const AUTO_REPLIES = [
  "Merci pour votre message ! Un membre de notre équipe vous répondra très bientôt. En attendant, n'hésitez pas à nous donner plus de détails sur votre problème.",
  "Bonjour ! Nous avons bien reçu votre question. Notre équipe est disponible du lundi au vendredi de 9h à 18h. Nous reviendrons vers vous rapidement.",
  "Merci de nous avoir contactés ! Votre demande a été enregistrée. Nous vous répondrons dans les plus brefs délais.",
  "Message reçu ! Notre équipe support va traiter votre demande. Merci de votre patience.",
];

const TOOLTIPS = ["👋 Besoin d'aide ?", "💬 Discutez avec nous"];
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
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return { x: vw - BUBBLE_SIZE - MARGIN, y: vh - BUBBLE_SIZE - MARGIN };
}

function loadPos() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const pos = JSON.parse(raw);
    if (typeof pos.x === 'number' && typeof pos.y === 'number') {
      return clampPos(pos.x, pos.y);
    }
  } catch (_) {}
  return null;
}

function savePos(pos) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(pos)); } catch (_) {}
}

// Snap to nearest edge (left or right)
function snapToEdge(x, y) {
  const vw = window.innerWidth;
  const midX = vw / 2;
  const snappedX = x < midX ? MARGIN : vw - BUBBLE_SIZE - MARGIN;
  return clampPos(snappedX, y);
}

// Find a safe position avoiding critical UI zones (input / send button area)
function avoidCriticalZones(x, y) {
  const CRITICAL_ZONES = [
    // Bottom-center input bar area (approx)
    { x: 0, y: window.innerHeight - 100, w: window.innerWidth, h: 100 },
  ];
  const bubbleRect = { x, y, w: BUBBLE_SIZE, h: BUBBLE_SIZE };

  for (const zone of CRITICAL_ZONES) {
    const overlap =
      bubbleRect.x < zone.x + zone.w &&
      bubbleRect.x + bubbleRect.w > zone.x &&
      bubbleRect.y < zone.y + zone.h &&
      bubbleRect.y + bubbleRect.h > zone.y;
    if (overlap) {
      // Move above the zone
      y = zone.y - BUBBLE_SIZE - MARGIN;
      break;
    }
  }
  return clampPos(x, y);
}

export default function SupportChatWidget({ user }) {
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [agentTyping, setAgentTyping] = useState(false);
  const [unread, setUnread] = useState(0);
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipText, setTooltipText] = useState(TOOLTIPS[0]);
  const [newMsgIds, setNewMsgIds] = useState(new Set());
  const [initialized, setInitialized] = useState(false);
  const [celebrateSignal, setCelebrateSignal] = useState(0);
  const [thinkingSignal, setThinkingSignal] = useState(false);
  const ashyRef = useRef(null);

  // Drag state
  const [pos, setPos] = useState(() => loadPos() || getDefaultPos());
  const [isDragging, setIsDragging] = useState(false);
  const [snapTransition, setSnapTransition] = useState(false);
  const dragStart = useRef(null); // { clientX, clientY, bx, by }
  const hasMoved = useRef(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const tooltipInterval = useRef(null);
  const autoReplyTimer = useRef(null);

  // On window resize, re-clamp position
  useEffect(() => {
    const onResize = () => {
      setPos(prev => {
        const clamped = clampPos(prev.x, prev.y);
        savePos(clamped);
        return clamped;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, agentTyping]);


  // Tooltip animation loop (only when widget is closed)
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

  // Load or create support chat
  const initChat = useCallback(async () => {
    if (!user?.id || initialized) return;
    setInitialized(true);
    try {
      const existing = await pb.collection('support_chats').getFirstListItem(
        `owner = "${user.id}" && status = "open"`,
        { requestKey: 'sc-load' }
      );
      setChat(existing);
      const msgs = await pb.collection('support_messages').getFullList({
        filter: `chat = "${existing.id}"`,
        sort: 'created',
        requestKey: 'sm-load',
      });
      setMessages(msgs);
    } catch (_) {
      try {
        const newChat = await pb.collection('support_chats').create({
          owner: user.id, status: 'open', unread_count: 0,
        }, { requestKey: 'sc-create' });
        setChat(newChat);
        const welcome = await pb.collection('support_messages').create({
          chat: newChat.id,
          content: "👋 Bonjour ! Bienvenue sur le support Ash Ledger.\nComment pouvons-nous vous aider aujourd'hui ?",
          sender_type: 'support',
          is_read: false,
        }, { requestKey: 'sm-welcome' });
        setMessages([welcome]);
      } catch (err) { console.error('Support chat init error', err); }
    }
  }, [user?.id, initialized]);

  useEffect(() => {
    if (open && user?.id) initChat();
  }, [open, user?.id, initChat]);

  // Realtime subscription
  useEffect(() => {
    if (!chat?.id) return;
    void pb.collection('support_messages').subscribe('*', (e) => {
      if (e.record.chat !== chat.id) return;
      if (e.action === 'create') {
        setMessages(prev => {
          if (prev.find(m => m.id === e.record.id)) return prev;
          return [...prev, e.record];
        });
        setNewMsgIds(prev => new Set([...prev, e.record.id]));
        if (!open && e.record.sender_type === 'support') setUnread(n => n + 1);
      }
    }, { requestKey: 'sc-realtime' }).catch(() => {});
    return () => { void pb.collection('support_messages').unsubscribe('*').catch(() => {}); };
  }, [chat?.id, open]);

  useEffect(() => { if (open) setUnread(0); }, [open]);

  // ── Drag handlers ──────────────────────────────────────────────────
  const onPointerDown = useCallback((e) => {
    e.preventDefault();
    hasMoved.current = false;
    dragStart.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      bx: pos.x,
      by: pos.y,
    };
    setIsDragging(true);
    setSnapTransition(false);
  }, [pos]);

  useEffect(() => {
    if (!isDragging) return;

    const onMove = (e) => {
      const client = e.touches ? e.touches[0] : e;
      const dx = client.clientX - dragStart.current.clientX;
      const dy = client.clientY - dragStart.current.clientY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasMoved.current = true;
      const newPos = clampPos(dragStart.current.bx + dx, dragStart.current.by + dy);
      setPos(newPos);
    };

    const onUp = (e) => {
      setIsDragging(false);
      setSnapTransition(true);
      setTimeout(() => setSnapTransition(false), 500);
      // Snap to nearest edge
      setPos(prev => {
        const client = e.changedTouches ? e.changedTouches[0] : e;
        const dx = client.clientX - dragStart.current.clientX;
        const dy = client.clientY - dragStart.current.clientY;
        const raw = clampPos(dragStart.current.bx + dx, dragStart.current.by + dy);
        const snapped = snapToEdge(raw.x, raw.y);
        const safe = avoidCriticalZones(snapped.x, snapped.y);
        savePos(safe);
        return safe;
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
    if (hasMoved.current) return; // was a drag, not a click
    setOpen(true);
    setShowTooltip(false);
  }, []);

  // ── Chat panel position (anchored relative to bubble) ──────────────
  const getPanelStyle = () => {
    const vw = window.innerWidth;
    const panelW = Math.min(vw - 48, 384);
    const panelH = Math.min(500, window.innerHeight - 120);
    const gap = 12;

    // Determine horizontal side: right edge of bubble vs left edge
    let left = pos.x;
    // If bubble is on right half, align panel to the right of bubble
    if (pos.x + BUBBLE_SIZE + gap + panelW > vw - MARGIN) {
      left = pos.x - panelW + BUBBLE_SIZE;
    } else {
      left = pos.x;
    }
    left = Math.max(MARGIN, Math.min(vw - panelW - MARGIN, left));

    let top = pos.y - panelH - gap;
    if (top < MARGIN) top = pos.y + BUBBLE_SIZE + gap;
    top = Math.max(MARGIN, Math.min(window.innerHeight - panelH - MARGIN, top));

    return { position: 'fixed', left, top, width: panelW, height: panelH, zIndex: 99 };
  };

  // ── Send message ───────────────────────────────────────────────────
  // Detect thanks keywords in message
  const isThanks = (text) => {
    const t = text.toLowerCase();
    return ['merci', 'thank', 'super', 'parfait', 'génial', 'excellent', 'bravo', '🙏'].some(k => t.includes(k));
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending || !chat) return;
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setSending(true);
    try {
      const msg = await pb.collection('support_messages').create({
        chat: chat.id, content: text, sender_type: 'user', is_read: false,
      });
      setMessages(prev => [...prev, msg]);
      setNewMsgIds(prev => new Set([...prev, msg.id]));
      // Choose reaction: thanks → hearts, else celebrate bounce
      if (isThanks(text)) {
        // no-op
      } else {
        setCelebrateSignal(s => s + 1);
      }
      autoReplyTimer.current = setTimeout(() => {
        setAgentTyping(true);
        // thinking state
        autoReplyTimer.current = setTimeout(async () => {
          setAgentTyping(false);
          // done thinking
          try {
            const reply = await pb.collection('support_messages').create({
              chat: chat.id,
              content: AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)],
              sender_type: 'support',
              is_read: false,
            });
            setMessages(prev => [...prev, reply]);
            setNewMsgIds(prev => new Set([...prev, reply.id]));

          } catch (_) {}
        }, 1800 + Math.random() * 1200);
      }, 600);
    } catch (err) { console.error('Failed to send support message', err); }
    finally { setSending(false); }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const handleTextarea = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 88) + 'px';
  };

  return (
    <>
      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="support-panel"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ type: 'spring', damping: 28, stiffness: 340 }}
            style={getPanelStyle()}
            className="rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ backgroundColor: '#FF6B00' }}>
              <div className="relative flex-shrink-0">
                <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-white/40">
                  <img src={SUPPORT_AVATAR} alt="Support" className="w-full h-full object-cover" />
                </div>
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-orange-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm leading-tight">Support Ash Ledger</p>
                <p className="text-orange-100 text-[11px] mt-0.5">En ligne · Répond rapidement</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/15 transition-colors"
              >
                <ChevronDown size={18} />
              </button>
            </div>

            {/* Messages area */}
            <div
              className="flex-1 overflow-y-auto py-3 px-3 space-y-1.5"
              style={{
                backgroundColor: '#EDE8E0',
                backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Cpath d='M 5 25 Q 15 15 25 25 Q 35 35 45 25 Q 55 15 65 25' stroke='%23c8b89a' stroke-width='0.5' fill='none' opacity='0.2'/%3E%3C/svg%3E\")",
                backgroundSize: '60px 60px',
              }}
            >
              <AnimatePresence initial={false}>
                {messages.map(msg => {
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
                          <img src={SUPPORT_AVATAR} alt="Support" className="w-full h-full object-cover" />
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] px-3 py-2 shadow-sm text-sm leading-relaxed whitespace-pre-wrap break-words ${
                          isUser
                            ? 'rounded-2xl rounded-br-sm text-white'
                            : 'rounded-2xl rounded-bl-sm text-gray-800 bg-white'
                        }`}
                        style={isUser ? { backgroundColor: '#FF6B00' } : {}}
                      >
                        {msg.content}
                        <div className="flex items-center justify-end gap-0.5 mt-0.5">
                          <span className={`text-[10px] tabular-nums ${isUser ? 'text-orange-200' : 'text-gray-400'}`}>
                            {getTime(msg.created)}
                          </span>
                          {isUser && <ReadTicks isRead={msg.is_read} />}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {/* Agent typing indicator */}
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
                      <img src={SUPPORT_AVATAR} alt="Support" className="w-full h-full object-cover" />
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

            {/* Input bar */}
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
                  placeholder="Votre message…"
                  rows={1}
                  className="w-full resize-none bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none leading-relaxed"
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

      {/* Draggable floating bubble */}
      <AnimatePresence>
        {!open && (
          <motion.div
            key="bubble-wrapper"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ type: 'spring', damping: 22, stiffness: 300 }}
            style={{
              position: 'fixed',
              left: pos.x,
              top: pos.y,
              zIndex: 100,
              touchAction: 'none',
              transition: snapTransition ? 'left 0.4s cubic-bezier(0.34,1.56,0.64,1), top 0.4s cubic-bezier(0.34,1.56,0.64,1)' : undefined,
            }}
            className="flex flex-col items-end gap-2"
          >
            {/* Tooltip */}
            <AnimatePresence>
              {showTooltip && !isDragging && (
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

            {/* Bubble */}
            <motion.button
              onPointerDown={onPointerDown}
              onClick={handleBubbleClick}
              className="relative flex items-center justify-center select-none"
              style={{
                width: BUBBLE_SIZE,
                height: BUBBLE_SIZE,
                borderRadius: '50%',
                background: 'transparent',
                border: 'none',
                padding: 0,
                margin: 0,
                boxShadow: 'none',
                cursor: isDragging ? 'grabbing' : 'grab',
              }}
              whileHover={{ scale: isDragging ? 1 : 1.08 }}
              whileTap={{ scale: 0.91 }}
            >
              <Ashy size={100} onOpenChat={handleBubbleClick} celebrateSignal={celebrateSignal} thinkingSignal={thinkingSignal} />

              {/* Unread badge */}
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

              {/* Drag hint ring — only while dragging */}
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
