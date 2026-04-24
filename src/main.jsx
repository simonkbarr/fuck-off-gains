import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Shim Claude's window.storage API onto localStorage so the app code
// works unchanged outside of Claude's artifact environment.
if (typeof window !== 'undefined' && !window.storage) {
  window.storage = {
    async get(key) {
      const v = localStorage.getItem(key);
      return v === null ? null : { key, value: v };
    },
    async set(key, value) {
      localStorage.setItem(key, value);
      return { key, value };
    },
    async delete(key) {
      const existed = localStorage.getItem(key) !== null;
      localStorage.removeItem(key);
      return { key, deleted: existed };
    },
    async list(prefix = '') {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      return { keys };
    },
  };
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
