import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Copy, CornerUpLeft, Forward, Trash2, CheckSquare, X } from 'lucide-react';

const ACTIONS = [
  { id: 'copy', label: 'Copier', icon: Copy },
  { id: 'reply', label: 'Répondre', icon: CornerUpLeft },
  { id: 'forward', label: 'Transférer', icon: Forward },
  { id: 'select', label: 'Sélectionner', icon: CheckSquare },
  { id: 'delete', label: 'Supprimer', icon: Trash2, danger: true, ownOnly: true },
];

/**
 * Native-style bottom action sheet for chat long-press (WhatsApp / Telegram feel).
 */
export default function MessageActionSheet({
  open,
  message,
  preview,
  onClose,
  onAction,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const isOwn = message?.role === 'user';
  const actions = ACTIONS.filter((a) => !a.ownOnly || isOwn);

  return (
    <AnimatePresence>
      {open && message && (
        <>
          <motion.button
            type="button"
            aria-label="Fermer"
            className="fixed inset-0 z-[80]"
            style={{ backgroundColor: 'rgba(15, 23, 42, 0.45)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Actions du message"
            className="fixed inset-x-0 bottom-0 z-[90] px-3"
            style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
            initial={{ y: '110%' }}
            animate={{ y: 0 }}
            exit={{ y: '110%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          >
            <div className="mx-auto max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="border-b border-stone-100 px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                    {isOwn ? 'Votre message' : 'Ash Ledger'}
                  </p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full p-1 text-stone-400 active:bg-stone-100"
                    aria-label="Fermer le menu"
                  >
                    <X size={16} />
                  </button>
                </div>
                <p className="line-clamp-3 text-sm leading-relaxed text-stone-700">
                  {preview || message.content}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-1 p-2 sm:grid-cols-5">
                {actions.map(({ id, label, icon: Icon, danger }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onAction?.(id, message)}
                    className="flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 active:scale-95 active:bg-stone-50"
                  >
                    <span
                      className="flex h-11 w-11 items-center justify-center rounded-full"
                      style={{
                        backgroundColor: danger ? '#FEE2E2' : '#FFF0E6',
                        color: danger ? '#DC2626' : '#FF6B00',
                      }}
                    >
                      <Icon size={20} strokeWidth={2} />
                    </span>
                    <span className={`text-[11px] font-semibold ${danger ? 'text-red-600' : 'text-stone-700'}`}>
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
