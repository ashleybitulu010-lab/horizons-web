import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import BrandIcon from '@/components/BrandIcon';
import { QUICK_ADD_ITEMS } from '@/lib/ashyChat';
import { BRAND } from '@/lib/brandAssets';

export default function QuickAddSheet({ open, onClose, onPick }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Fermer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] bg-black/40"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-labelledby="quick-add-title"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="fixed inset-x-0 bottom-0 z-[81] rounded-t-3xl bg-white px-4 pt-3 shadow-2xl lg:inset-x-auto lg:left-1/2 lg:w-full lg:max-w-md lg:-translate-x-1/2"
            style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-200" />
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 id="quick-add-title" className="text-base font-semibold" style={{ color: BRAND.text }}>
                  Ajouter rapidement
                </h2>
                <p className="text-xs" style={{ color: BRAND.textMuted }}>
                  Ashy prépare la phrase — tu complètes et tu envoies.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-11 w-11 items-center justify-center rounded-full text-stone-400 active:bg-stone-100"
                aria-label="Fermer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid max-h-[min(70vh,520px)] gap-2 overflow-y-auto pb-2">
              {QUICK_ADD_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onPick(item)}
                  className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-stone-100 bg-[#F8FAFD] px-3 py-2.5 text-left active:scale-[0.99]"
                >
                  <BrandIcon name={item.icon} size={40} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold" style={{ color: BRAND.text }}>
                      {item.title}
                    </span>
                    <span className="block text-xs" style={{ color: BRAND.textMuted }}>
                      {item.subtitle}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
