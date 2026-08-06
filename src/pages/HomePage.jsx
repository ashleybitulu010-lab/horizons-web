import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Send, Bot, CheckCheck } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
const SESSION_KEY = 'n8n-chat-session';
function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = 'sess-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}
function nowTime() {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}
const HomePage = () => {
  const [messages, setMessages] = useState([{
    id: 'welcome',
    from: 'bot',
    text: "Bonjour ! Je suis votre assistant IA. Posez-moi une question.",
    time: nowTime()
  }]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);
  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const userMsg = {
      id: 'u-' + Date.now(),
      from: 'user',
      text,
      time: nowTime()
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);
    try {
      const res = await apiServerClient.fetch('/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: text,
          sessionId: getSessionId()
        })
      });
      const data = await res.json().catch(() => ({}));
      const errorText = (data && data.error && typeof data.error === 'object' ? data.error.message : data.error) || (typeof data?.message === 'string' ? data.message : null) || "L'assistant n'est pas encore configuré (webhook n8n manquant). Réessayez plus tard.";
      const reply = res.ok ? typeof data.reply === 'string' ? data.reply : "Je n'ai pas reçu de réponse de l'agent." : errorText;
      setMessages(prev => [...prev, {
        id: 'b-' + Date.now(),
        from: 'bot',
        text: reply,
        time: nowTime(),
        error: !res.ok
      }]);
    } catch {
      setMessages(prev => [...prev, {
        id: 'e-' + Date.now(),
        from: 'bot',
        text: "Impossible de joindre le serveur. Réessayez.",
        time: nowTime(),
        error: true
      }]);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };
  const onKeyDown = e => {
    if (
      e.key === 'Enter'
      && !e.shiftKey
      && (e.ctrlKey || e.metaKey)
      && !e.nativeEvent?.isComposing
    ) {
      e.preventDefault();
      send();
    }
  };
  return <div className="flex h-[100dvh] w-full items-center justify-center bg-[#0b141a] p-0 sm:p-6">
            <Helmet>
                <title>Assistant IA — Chat n8n</title>
                <meta name="description" content="Interface de discussion conversationnelle connectée à votre agent IA n8n." />
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
            </Helmet>

            <div className="flex h-full w-full max-w-2xl flex-col overflow-hidden bg-[#0b141a] shadow-2xl sm:h-[92vh] sm:rounded-2xl sm:ring-1 sm:ring-white/10" style={{
      fontFamily: 'Inter, sans-serif'
    }}>
                {/* Header */}
                <header className="flex items-center gap-3 bg-[#202c33] px-4 py-3">
                    <div className="relative">
                        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#00a884]">
                            <Bot className="h-6 w-6 text-white" strokeWidth={2} />
                        </div>
                        <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#202c33] bg-[#25d366]" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-[15px] font-semibold text-[#e9edef]">Ash Ledger&nbsp;</h1>
                        <p className="truncate text-xs text-[#8696a0]">
                            {sending ? "en train d'écrire…" : 'en ligne'}
                        </p>
                    </div>
                </header>

                {/* Messages */}
                <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-4 sm:px-6" style={{
        backgroundColor: '#0b141a',
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)',
        backgroundSize: '22px 22px'
      }}>
                    {messages.map(m => {
          const isUser = m.from === 'user';
          return <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                                <div className={`relative max-w-[80%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-[14.5px] leading-snug shadow-sm ${isUser ? 'rounded-tr-none bg-[#005c4b] text-[#e9edef]' : m.error ? 'rounded-tl-none bg-[#3a2226] text-[#f4c7c7]' : 'rounded-tl-none bg-[#202c33] text-[#e9edef]'}`}>
                                    <span>{m.text}</span>
                                    <span className="ml-2 inline-flex translate-y-1 items-center gap-1 text-[10px] text-white/50">
                                        {m.time}
                                        {isUser && <CheckCheck className="h-3.5 w-3.5" />}
                                    </span>
                                </div>
                            </div>;
        })}

                    {sending && <div className="flex justify-start">
                            <div className="flex items-center gap-1.5 rounded-lg rounded-tl-none bg-[#202c33] px-4 py-3">
                                <span className="h-2 w-2 animate-bounce rounded-full bg-[#8696a0] [animation-delay:-0.3s]" />
                                <span className="h-2 w-2 animate-bounce rounded-full bg-[#8696a0] [animation-delay:-0.15s]" />
                                <span className="h-2 w-2 animate-bounce rounded-full bg-[#8696a0]" />
                            </div>
                        </div>}
                </div>

                {/* Composer */}
                <div className="flex items-end gap-2 bg-[#202c33] px-3 py-3">
                    <textarea ref={textareaRef} rows={1} value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown} enterKeyHint="enter" placeholder="Écrivez un message" className="max-h-32 flex-1 resize-none rounded-2xl bg-[#2a3942] px-4 py-2.5 text-[15px] text-[#e9edef] placeholder:text-[#8696a0] focus:outline-none" />
                    <button onClick={send} disabled={!input.trim() || sending} aria-label="Envoyer" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white transition active:scale-95 disabled:opacity-40">
                        <Send className="h-5 w-5" strokeWidth={2} />
                    </button>
                </div>
            </div>
        </div>;
};
export default HomePage;