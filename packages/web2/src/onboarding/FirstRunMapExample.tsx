/* ══════════════════════════════════════════════════════════════════════════
   FIRST RUN, MAP STEP: THE ON / OFF EXAMPLE
   packages/web2/src/onboarding/FirstRunMapExample.tsx

   Two small previews side by side, drawn with the context meter's look (the
   .ctxring-meter bar the status bar's context panel uses), against an example
   500k-token window. Owner: "show them literally an example of what it looks
   like when it's large, when you take it off show an example of that as well".
   Numbers: mapExample.ts says where each comes from.
   ══════════════════════════════════════════════════════════════════════════ */

import { EXAMPLE_WINDOW_TOKENS, mapExample, tokensShort } from './mapExample';

export function FirstRunMapExample({ tokens }: { tokens: number | null }) {
  const ex = mapExample(tokens);
  const win = tokensShort(EXAMPLE_WINDOW_TOKENS);
  return (
    <div className="fr-mapex" data-testid="first-run-map-example">
      <div className="fr-mapex-col" data-testid="first-run-map-on" data-share={ex.share}>
        <span className="fr-mapex-h">On</span>
        <div className="ctxring-meter" role="meter" aria-label="Example context window with the map" aria-valuemin={0} aria-valuemax={EXAMPLE_WINDOW_TOKENS} aria-valuenow={ex.tokens}>
          <span className="ctxring-seg" style={{ width: `${Math.max(ex.share * 100, 0.6)}%` }} />
        </div>
        <span className="fr-mapex-n mono">
          map {tokensShort(ex.tokens)} of {win} ({ex.percent})
          {ex.measured ? '' : ', example'}
        </span>
        <p className="fr-mapex-s">The agent starts each turn already knowing how your services connect.</p>
      </div>
      <div className="fr-mapex-col" data-testid="first-run-map-off" data-share="0">
        <span className="fr-mapex-h">Off</span>
        <div className="ctxring-meter" role="meter" aria-label="Example context window without the map" aria-valuemin={0} aria-valuemax={EXAMPLE_WINDOW_TOKENS} aria-valuenow={0} />
        <span className="fr-mapex-n mono">map 0 of {win}, example</span>
        <p className="fr-mapex-s">Nothing is added. The agent works the layout out by reading files itself.</p>
      </div>
    </div>
  );
}
