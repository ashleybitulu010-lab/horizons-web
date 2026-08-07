import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/index.css';
import { registerPwaInstallBridge, registerServiceWorker } from '@/lib/pwaInstallBridge';

// Capture install prompt + register SW before React mounts (avoids missed BIP).
registerPwaInstallBridge();
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')).render(
	<App />
);
