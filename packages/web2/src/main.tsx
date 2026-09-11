import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';

/**
 * The entry point. Root branch and mount only — no CSS imports, no business
 * logic, no router.
 *
 * The v1 entry carried a 15-import CSS block under a 27-line comment arguing
 * its own specificity order. That block does not come across; the ordered
 * import lives in App.tsx where the shell that depends on it can be read
 * beside it.
 *
 * One branch belongs here eventually and is not written yet: the popout
 * surface split on window.location.search. It is a real capability, it is a
 * branch at the ROOT rather than a route, and it is the single thing the
 * rebuild kept as intent from the old entry. The v1 parser died with
 * `packages/web` — rewrite in web2 if a popout wave lands; never import from
 * the deleted package. See app/routes.ts.
 */
const host = document.getElementById('root');
if (!host) throw new Error('#root missing from index.html');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
