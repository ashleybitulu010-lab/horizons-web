import { Download, Share, Smartphone } from 'lucide-react';
import { usePwaInstall } from '@/hooks/usePwaInstall';

const APP_ICON = '/icons/icon-192.png';

export default function InstallAppBanner() {
  const { installed, iosHint, dismissIosHint, promptInstall } = usePwaInstall();

  if (installed) return null;

  return (
    <div
      className="flex-shrink-0 border-b px-3 py-2.5"
      style={{ backgroundColor: '#FFF8F2', borderColor: 'rgba(255,107,0,0.2)' }}
    >
      <div className="flex items-center gap-3">
        <img
          src={APP_ICON}
          alt="Ash Ledger"
          className="h-11 w-11 flex-shrink-0 rounded-2xl border border-orange-100 object-cover shadow-sm"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-stone-800 leading-tight">
            Installer Ash Ledger
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-stone-500">
            Ajoutez l’app sur votre téléphone pour un accès rapide.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void promptInstall(); }}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white active:scale-95"
          style={{ backgroundColor: '#FF6B00' }}
        >
          <Download size={14} strokeWidth={2.2} />
          Télécharger
        </button>
      </div>

      {iosHint && (
        <div className="mt-2 rounded-xl border border-orange-100 bg-white px-3 py-2.5 text-[11px] leading-relaxed text-stone-600">
          <p className="font-semibold text-orange-700 flex items-center gap-1.5 mb-1">
            <Smartphone size={13} />
            Sur iPhone / iPad
          </p>
          <ol className="list-decimal pl-4 space-y-0.5">
            <li>
              Appuyez sur <Share size={11} className="inline text-orange-500" /> Partager
            </li>
            <li>Choisissez « Sur l’écran d’accueil »</li>
            <li>Confirmez — le logo Ash Ledger apparaîtra sur votre téléphone</li>
          </ol>
          <button
            type="button"
            onClick={dismissIosHint}
            className="mt-2 text-[11px] font-semibold text-orange-600"
          >
            Compris
          </button>
        </div>
      )}
    </div>
  );
}
