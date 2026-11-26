import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import './index.css';
import './lib/install';
import App from './App';
import { DataProvider, UIProvider, usePrefs } from './state';

function ThemedToaster() {
  const [prefs] = usePrefs();
  return <Toaster position="top-center" theme={prefs.theme} richColors closeButton offset={16} toastOptions={{ duration: 3500 }} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider>
      <UIProvider>
        <App />
        <ThemedToaster />
      </UIProvider>
    </DataProvider>
  </StrictMode>,
);
