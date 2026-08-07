import { useCallback, useEffect, useState } from 'react';
import {
  detectInstallPlatform,
  getDeferredInstallPrompt,
  isAppInstalled,
  markPwaInstalled,
  promptNativeInstall,
  subscribeAppInstalled,
  subscribeInstallPrompt,
} from '@/lib/pwaInstallBridge';

export { isAppInstalled };

export function usePwaInstall() {
  const [installed, setInstalled] = useState(() => isAppInstalled());
  const [canNativeInstall, setCanNativeInstall] = useState(() => Boolean(getDeferredInstallPrompt()));
  const [showHelp, setShowHelp] = useState(false);
  const [platform, setPlatform] = useState(() => detectInstallPlatform());

  useEffect(() => {
    setPlatform(detectInstallPlatform());

    if (isAppInstalled()) {
      markPwaInstalled();
      setInstalled(true);
    }

    const unsubPrompt = subscribeInstallPrompt((event) => {
      setCanNativeInstall(Boolean(event));
    });
    const unsubInstalled = subscribeAppInstalled(() => {
      setInstalled(true);
      setCanNativeInstall(false);
      setShowHelp(false);
    });

    const media = window.matchMedia('(display-mode: standalone)');
    const onDisplayChange = () => {
      if (isAppInstalled()) {
        markPwaInstalled();
        setInstalled(true);
      }
    };
    media.addEventListener?.('change', onDisplayChange);

    return () => {
      unsubPrompt();
      unsubInstalled();
      media.removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (installed) return { outcome: 'already-installed' };

    if (getDeferredInstallPrompt()) {
      const choice = await promptNativeInstall();
      if (choice.outcome === 'accepted') {
        setInstalled(true);
        setShowHelp(false);
      } else if (choice.outcome === 'dismissed') {
        setShowHelp(true);
      }
      setCanNativeInstall(Boolean(getDeferredInstallPrompt()));
      return choice;
    }

    // No native prompt available yet (iOS, in-app browser, desktop without BIP, race).
    setShowHelp(true);
    return { outcome: 'manual', platform: detectInstallPlatform().kind };
  }, [installed]);

  return {
    installed,
    canNativeInstall,
    platform,
    showHelp,
    iosHint: showHelp,
    dismissHelp: () => setShowHelp(false),
    dismissIosHint: () => setShowHelp(false),
    promptInstall,
  };
}
