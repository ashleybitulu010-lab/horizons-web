import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Copy, CornerUpLeft, Forward, Trash2, CheckSquare, X } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

const ACTION_DEFS = [
  { id: 'copy', labelKey: 'msg.copy', icon: Copy },
  { id: 'reply', labelKey: 'msg.reply', icon: CornerUpLeft },
  { id: 'forward', labelKey: 'msg.forward', icon: Forward },
  { id: 'select', labelKey: 'msg.select', icon: CheckSquare },
  { id: 'delete', labelKey: 'msg.delete', icon: Trash2, danger: true, ownOnly: true },
];

/**
 * Native-style bottom action sheet for chat long-press (WhatsApp / Telegram feel).
 * Portaled to document.body so it always sits above overlays (Ashy panel, drawers).
 */
export default function MessageActionSheet({
  open,
  message,
  preview,
  onClose,
  onAction,
}) {
  const { t } = useLanguage();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const isOwn = message?.role === 'user' || message?.sender_type === 'user';
  const fromAshy =
    message?.sender_type === 'support'
    || message?.sender_type === 'assistant'
    || message?.role === 'assistant';
  const headerLabel = isOwn
    ? t('msg.yourMessage')
    : fromAshy
      ? 'Ashy'
      : 'Ash Ledger';
  const actions = ACTION_DEFS.filter((a) => !a.ownOnly || isOwn);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && message && (
        <>
          <motion.button
            type="button"
            aria-label={t('common.close')}
            className="fixed inset-0 z-[110]"
            style={{ backgroundColor: 'rgba(15, 23, 42, 0.45)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t('msg.actions')}
            className="fixed inset-x-0 bottom-0 z-[120] px-3"
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
                    {headerLabel}
                  </p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full p-1 text-stone-400 active:bg-stone-100"
                    aria-label={t('msg.closeMenu')}
                  >
                    <X size={16} />
                  </button>
                </div>
                <p className="line-clamp-3 text-sm leading-relaxed text-stone-700">
                  {preview || message.content}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-1 p-2 sm:grid-cols-5">
                {actions.map(({ id, labelKey, icon: Icon, danger }) => (
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
                      {t(labelKey)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
