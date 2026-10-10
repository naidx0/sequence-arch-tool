import { bootFetchCache } from './bootFetchCache';

/* Imported first in main.tsx: ES modules run in import order, so this wraps fetch
   before any client module captures globalThis.fetch at load. Installed later,
   those clients' writes skipped the wrapper and never cleared the cache. */
window.fetch = bootFetchCache(window.fetch.bind(window));
