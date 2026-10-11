/* Must stay the first import: wraps fetch before any client captures it (boot/installBootFetchCache.ts). */
import './boot/installBootFetchCache';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyAccent, readAccent } from './settings/accentPreference';
import { applyFont } from './settings/fontPreference';
import { quietWhenHidden } from './styles/quietWhenHidden';

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
/*
 * THE APPEARANCE EXPERIMENT, RE-ASSERTED BEFORE THE FIRST RENDER.
 * index.html already set `data-accent` before this module existed, which is the
 * only way to get it onto frame one. This line is not that job — it is the line
 * that makes the ENTRY not depend on the inline script being right, so any host
 * that mounts this bundle with its own HTML (the desktop shell, a preview page,
 * a test harness) lands on the same accent as the browser does. It runs before
 * createRoot, so it is still ahead of the first paint React causes.
 * GRAPHITE-DECISIONS.md Decision 29.
 */
applyAccent(readAccent());
/* The interface font (Settings > Appearance), applied before the first render like the accent above. */
applyFont();
/* Round 13: the boot GET cache (sessions, skills, agents asked once) is installed by the first import above. */
/* S4: no CSS animation runs while the window is hidden (tokens/graphite.css). */
quietWhenHidden();

const host = document.getElementById('root');
if (!host) throw new Error('#root missing from index.html');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/* THE BOOT SPLASH LEAVES ON THE FIRST FRAME React paints: a 160ms fade, then
   it is removed. Two animation frames, because the first runs before the
   committed tree has been painted. A splash that never got its frame (a
   background tab) is removed by the timer. */
/* THE STATIC SHELL (index.html, scripts/prerender-shell.mjs) is taken by
   V3Chat on mount, with whatever was typed in it. If React drew something
   without a composer, it must still not sit over the app. Not on the next
   frame: createRoot commits a large first tree later than that, and removing
   the shell before V3Chat reads it loses what was typed (static-shell test). */
window.setTimeout(() => document.getElementById('static-shell')?.remove(), 5000);

const splash = document.getElementById('boot-splash');
if (splash) {
  const remove = () => splash.remove();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      splash.classList.add('is-done');
      splash.addEventListener('transitionend', remove, { once: true });
      window.setTimeout(remove, 400);
    }),
  );
}
