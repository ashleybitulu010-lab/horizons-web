import { Download, Share, Smartphone } from 'lucide-react';
import { usePwaInstall } from '@/hooks/usePwaInstall';

const APP_ICON = '/icons/icon-192.png';

function InstallHelp({ platform, onDismiss }) {
  if (platform.isInApp) {
    return (
      <div className="mt-2 rounded-xl border border-orange-100 bg-white px-3 py-2.5 text-[11px] leading-relaxed text-stone-600">
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-orange-700">
          <Smartphone size={13} />
          Ouvrez dans le navigateur
        </p>
        <p>
          L’installation n’est pas disponible dans cette application.
          Ouvrez ashledger.tech dans <strong>Chrome</strong> (Android) ou <strong>Safari</strong> (iPhone),
          puis appuyez sur Installer.
        </p>
        <button type="button" onClick={onDismiss} className="mt-2 text-[11px] font-semibold text-orange-600">
          Compris
        </button>
      </div>
    );
  }

  if (platform.isIos) {
    return (
      <div className="mt-2 rounded-xl border border-orange-100 bg-white px-3 py-2.5 text-[11px] leading-relaxed text-stone-600">
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-orange-700">
          <Smartphone size={13} />
          Sur iPhone / iPad (Safari)
        </p>
        <ol className="list-decimal space-y-0.5 pl-4">
          <li>
            Appuyez sur <Share size={11} className="inline text-orange-500" /> Partager
          </li>
          <li>Choisissez « Sur l’écran d’accueil »</li>
          <li>Confirmez — Ash Ledger apparaît comme une app</li>
        </ol>
        <button type="button" onClick={onDismiss} className="mt-2 text-[11px] font-semibold text-orange-600">
          Compris
        </button>
      </div>
    );
  }

  if (platform.isAndroid) {
    return (
      <div className="mt-2 rounded-xl border border-orange-100 bg-white px-3 py-2.5 text-[11px] leading-relaxed text-stone-600">
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-orange-700">
          <Smartphone size={13} />
          Sur Android (Chrome)
        </p>
        <ol className="list-decimal space-y-0.5 pl-4">
          <li>Appuyez sur ⋮ en haut à droite</li>
          <li>Choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil »</li>
          <li>Confirmez — Ash Ledger s’ouvre sans barre d’adresse</li>
        </ol>
        <button type="button" onClick={onDismiss} className="mt-2 text-[11px] font-semibold text-orange-600">
          Compris
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-orange-100 bg-white px-3 py-2.5 text-[11px] leading-relaxed text-stone-600">
      <p className="mb-1 flex items-center gap-1.5 font-semibold text-orange-700">
        <Smartphone size={13} />
        Installer depuis l’ordinateur
      </p>
      <p>
        Dans Chrome ou Edge, ouvrez le menu (⋮) puis « Installer Ash Ledger »,
        ou utilisez l’icône d’installation dans la barre d’adresse.
      </p>
      <p className="mt-1 text-stone-500">
        Sur téléphone, ouvrez https://ashledger.tech dans Chrome ou Safari pour installer l’app.
      </p>
      <button type="button" onClick={onDismiss} className="mt-2 text-[11px] font-semibold text-orange-600">
        Compris
      </button>
    </div>
  );
}

export default function InstallAppBanner() {
  const {
    installed,
    canNativeInstall,
    platform,
    showHelp,
    dismissHelp,
    promptInstall,
  } = usePwaInstall();

  if (installed) return null;

  return (
    <div
      className="flex-shrink-0 border-b px-3 py-2.5"
      style={{ backgroundColor: '#FFF8F2', borderColor: 'rgba(255,107,0,0.2)' }}
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          <img
            src={APP_ICON}
            alt="Ash Ledger"
            className="h-11 w-11 flex-shrink-0 rounded-2xl border border-orange-100 object-cover shadow-sm"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight text-stone-800">
              Installer Ash Ledger
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-stone-500">
              Ajoutez l’app sur votre téléphone pour un accès rapide.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            void promptInstall();
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold text-white active:scale-[0.98]"
          style={{ backgroundColor: '#FF6B00' }}
        >
          <Download size={16} strokeWidth={2.2} />
          {canNativeInstall ? 'Installer Ash Ledger' : 'Télécharger Ash Ledger'}
        </button>
      </div>

      {showHelp && <InstallHelp platform={platform} onDismiss={dismissHelp} />}
    </div>
  );
}
