import { useCallback, useEffect, useState } from 'react';

const INSTALLED_KEY = 'ash_pwa_installed';

export function isAppInstalled() {
  if (typeof window === 'undefined') return false;
  try {
    if (localStorage.getItem(INSTALLED_KEY) === '1') return true;
  } catch {
    /* ignore */
  }
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
  return Boolean(standalone);
}

function markInstalled() {
  try {
    localStorage.setItem(INSTALLED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function usePwaInstall() {
  const [installed, setInstalled] = useState(() => isAppInstalled());
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isAppInstalled()) {
      markInstalled();
      setInstalled(true);
    }

    const onBeforeInstall = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    const onInstalled = () => {
      markInstalled();
      setInstalled(true);
      setDeferredPrompt(null);
      setIosHint(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    const media = window.matchMedia('(display-mode: standalone)');
    const onDisplayChange = () => {
      if (isAppInstalled()) {
        markInstalled();
        setInstalled(true);
      }
    };
    media.addEventListener?.('change', onDisplayChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      media.removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (installed) return { outcome: 'already-installed' };

    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      if (choice.outcome === 'accepted') {
        markInstalled();
        setInstalled(true);
      }
      return choice;
    }

    // iOS / browsers without beforeinstallprompt
    const ua = navigator.userAgent || '';
    const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIos) {
      setIosHint(true);
      return { outcome: 'ios-instructions' };
    }

    setIosHint(true);
    return { outcome: 'manual' };
  }, [deferredPrompt, installed]);

  return {
    installed,
    canNativeInstall: Boolean(deferredPrompt),
    iosHint,
    dismissIosHint: () => setIosHint(false),
    promptInstall,
  };
}
