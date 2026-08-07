/**
 * Captures beforeinstallprompt as early as possible so React mount timing
 * cannot miss the event (common cause of a dead "Installer" button).
 */

const INSTALLED_KEY = 'ash_pwa_installed';

let deferredPrompt = null;
const promptListeners = new Set();
const installedListeners = new Set();

function notifyPrompt() {
  promptListeners.forEach((fn) => {
    try {
      fn(deferredPrompt);
    } catch {
      /* ignore */
    }
  });
}

function notifyInstalled() {
  installedListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

export function markPwaInstalled() {
  try {
    localStorage.setItem(INSTALLED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function isPwaInstalledFlag() {
  try {
    return localStorage.getItem(INSTALLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function isDisplayStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true
  );
}

export function isAppInstalled() {
  return isPwaInstalledFlag() || isDisplayStandalone();
}

export function getDeferredInstallPrompt() {
  return deferredPrompt;
}

export function subscribeInstallPrompt(listener) {
  promptListeners.add(listener);
  if (deferredPrompt) listener(deferredPrompt);
  return () => promptListeners.delete(listener);
}

export function subscribeAppInstalled(listener) {
  installedListeners.add(listener);
  return () => installedListeners.delete(listener);
}

export function detectInstallPlatform() {
  if (typeof navigator === 'undefined') {
    return { kind: 'unknown', isIos: false, isAndroid: false, isInApp: false };
  }
  const ua = navigator.userAgent || '';
  const isIos =
    /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isInApp =
    /\bFBAN|FBAV|Instagram|Line\/|Twitter|Pinterest|Snapchat|WhatsApp|Telegram|TikTok|Bytedance|MicroMessenger|wv\)/i.test(ua)
    || (isAndroid && /\bwv\b/.test(ua) && !/Chrome\/[.0-9]* Mobile/i.test(ua));
  let kind = 'desktop';
  if (isIos) kind = 'ios';
  else if (isAndroid) kind = 'android';
  return { kind, isIos, isAndroid, isInApp };
}

export async function promptNativeInstall() {
  const event = deferredPrompt;
  if (!event) return { outcome: 'unavailable' };

  deferredPrompt = null;
  notifyPrompt();

  event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === 'accepted') {
    markPwaInstalled();
    notifyInstalled();
  }
  return choice;
}

export function registerPwaInstallBridge() {
  if (typeof window === 'undefined' || window.__ashPwaBridge) return;
  window.__ashPwaBridge = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    notifyPrompt();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    markPwaInstalled();
    notifyPrompt();
    notifyInstalled();
  });
}

export function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  return navigator.serviceWorker
    .register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .then((registration) => {
      registration.update().catch(() => {});
      return registration;
    })
    .catch(() => null);
}
