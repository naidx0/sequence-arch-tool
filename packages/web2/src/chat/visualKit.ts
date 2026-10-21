/* THE APP'S OWN COMPONENTS, FOR AN AGENT'S ```html DRAWING. packages/web2/src/chat/visualKit.ts

   An html drawing runs in its own document (no app CSS reaches it), so a page that invents its styles looks
   freelance: a gradient, a bright palette, a chunky native scrollbar. This sheet is put in that document before the
   agent's page. It mirrors the app's components with the app's token values, and reads the six --seq-* theme
   variables, so it follows light and dark with the app:

     .seq-card   the glass card (shell2 --glass, --glass-edge hairline, --r-14)
     .seq-btn    the app's .s2-btn (glass fill, accent-tinted hairline, pill, --control-h-lg)
     .seq-btn.primary   its .s2-blue (the accent fill)
     .seq-chip   a state label (--r-full, hairline, --t-11-5)
     .seq-row    a wrapping row, 8 px gap, items centred
     .seq-stack  a column, 8 px gap
     .seq-muted  secondary text (--ink-3)

   The document scrollbar is the app's: 6 px, a transparent track, a thumb at the app's --scrollbar-thumb alpha.
   The values are the app tokens' (tokens/graphite.css): --r-14, --sp-8, --sp-12, --control-h-lg 32px, --fw-label 500,
   --t-11-5, --font-sans. The class list is named in the agent's drawing rules (packages/acp accessMode.ts). */

/** The classes the agent is told about, in the order the prompt lists them. */
export const VISUAL_KIT_CLASSES = ['seq-card', 'seq-btn', 'seq-chip', 'seq-row', 'seq-stack', 'seq-muted'] as const;

/** The app's body face (--font-sans). The frame cannot load app fonts (its CSP is font-src data:), so Inter shows where it is installed. */
export const VISUAL_FONT = '"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif';

/** The kit as one <style> body. Plain CSS over --seq-* only; no braces from outside, so it is safe to inline. */
export const VISUAL_KIT_CSS = [
  /* The app's thin scrollbar (base.css): 6px, transparent track, a pill thumb. */
  '::-webkit-scrollbar{width:6px;height:6px}',
  '::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}',
  '::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--seq-fg) 16%,transparent);border-radius:999px}',
  '::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--seq-fg) 28%,transparent)}',
  '@supports not selector(::-webkit-scrollbar){html{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--seq-fg) 16%,transparent) transparent}}',
  /* The frame is its own document: the two app tokens the kit uses are carried in by name (graphite.css values). */
  ':root{--fw-label:500;--t-11-5:11.5px}',
  '.seq-card,.seq-btn,.seq-chip,.seq-row,.seq-stack{box-sizing:border-box}',
  '.seq-card{background:color-mix(in srgb,var(--seq-surface) 62%,transparent);border:1px solid color-mix(in srgb,var(--seq-edge) 80%,var(--seq-accent) 20%);border-radius:14px;padding:12px}',
  '.seq-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
  '.seq-stack{display:flex;flex-direction:column;gap:8px}',
  '.seq-muted{color:var(--seq-muted)}',
  '.seq-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:32px;padding:0 12px;border-radius:999px;font:inherit;font-weight:var(--fw-label);cursor:pointer;white-space:nowrap;' +
    'border:1px solid color-mix(in srgb,var(--seq-edge) 80%,var(--seq-accent) 20%);background:color-mix(in srgb,var(--seq-surface) 62%,transparent);color:var(--seq-fg)}',
  '.seq-btn:hover{background:color-mix(in srgb,var(--seq-surface) 85%,var(--seq-fg) 6%)}',
  '.seq-btn:active{transform:scale(.97)}',
  '.seq-btn:disabled{opacity:.5;cursor:default}',
  '.seq-btn.primary{background:var(--seq-accent);color:var(--seq-bg);border-color:transparent}',
  '.seq-btn.primary:hover{background:color-mix(in srgb,var(--seq-accent) 88%,var(--seq-fg))}',
  '.seq-chip{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;border:1px solid var(--seq-edge);color:var(--seq-muted);font-size:var(--t-11-5);line-height:16px}',
].join('');
