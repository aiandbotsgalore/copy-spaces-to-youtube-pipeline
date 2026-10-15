import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Shield application from third-party browser extension storage/LevelDB failures
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const msg = (reason && (reason.message || reason.stack || String(reason))) || '';
    if (
      msg.includes('FILE_ERROR_NO_SPACE') ||
      msg.includes('ChromeMethodBFE') ||
      msg.includes('.ldb') ||
      msg.includes('globals-front.js') ||
      msg.includes('content.js')
    ) {
      event.preventDefault();
      console.warn('[Extension Storage Handled] Suppressed third-party browser extension LevelDB storage rejection:', msg);
    }
  });

  window.addEventListener('error', (event: ErrorEvent) => {
    const filename = event.filename || '';
    const msg = event.message || '';
    if (
      filename.includes('globals-front.js') ||
      filename.includes('content.js') ||
      msg.includes('FILE_ERROR_NO_SPACE') ||
      msg.includes('ChromeMethodBFE')
    ) {
      event.preventDefault();
      console.warn('[Extension Error Handled] Suppressed third-party browser extension runtime error:', msg);
    }
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);