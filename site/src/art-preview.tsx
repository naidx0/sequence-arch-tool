import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import { AccuracyArt, ModelsArt, SpeedArt, SystemDesignArt, TokensArt } from '@/components/lt/art';
import { DEPTH_MEASURED, tokens } from '@/components/DepthCharts';

/**
 * DEV-ONLY PREVIEW of the five advantage drawings (art-preview.html, served
 * by `vite`, not a build input). `?w=390` sets the width they render at,
 * `?p=0.5` the progress; the slider scrubs it. `window.__artFit()` measures
 * every text carrying data-fit against the width it was given and returns the
 * overflows, so a screenshot run can check that nothing spills.
 */

const params = new URLSearchParams(window.location.search);
const W = Number(params.get('w') ?? 1180);
const P0 = Number(params.get('p') ?? 1);
const last = DEPTH_MEASURED.rows[DEPTH_MEASURED.rows.length - 1]!;

const PIECES = [
  { id: 'system-design', name: 'SystemDesignArt', render: (p: number) => <SystemDesignArt progress={p} /> },
  { id: 'tokens', name: 'TokensArt', render: (p: number) => <TokensArt progress={p} readTokens={tokens(last.bytesRead)} answerTokens={tokens(last.bytesAnswer)} filesRead={last.files} /> },
  { id: 'speed', name: 'SpeedArt', render: (p: number) => <SpeedArt progress={p} lookups={last.grep} calls={last.sequence} /> },
  { id: 'accuracy', name: 'AccuracyArt', render: (p: number) => <AccuracyArt progress={p} /> },
  { id: 'models', name: 'ModelsArt', render: (p: number) => <ModelsArt progress={p} /> },
];

declare global {
  interface Window {
    __artFit?: () => { piece: string; text: string; width: number; fit: number }[];
  }
}

window.__artFit = () => {
  const out: { piece: string; text: string; width: number; fit: number }[] = [];
  document.querySelectorAll<SVGTextElement>('[data-art] text[data-fit]').forEach((el) => {
    const fit = Number(el.dataset.fit);
    const width = el.getComputedTextLength();
    if (width > fit) out.push({ piece: el.closest<HTMLElement>('[data-art]')!.dataset.art!, text: el.textContent ?? '', width: Math.round(width * 10) / 10, fit });
  });
  return out;
};

function Preview() {
  const [p, setP] = useState(P0);
  return (
    <div className="lt-page" style={{ padding: 24, display: 'grid', gap: 48, justifyItems: 'start' }}>
      <label style={{ font: '13px Inter, system-ui', display: 'flex', gap: 12, alignItems: 'center' }}>
        progress {p.toFixed(2)}
        <input type="range" min={0} max={1} step={0.01} value={p} onChange={(e) => setP(Number(e.target.value))} style={{ width: 320 }} />
        <span>width {W}px</span>
      </label>
      {PIECES.map((piece) => (
        <section key={piece.id} data-art={piece.id} style={{ width: W, maxWidth: '100%' }}>
          <p style={{ font: '600 13px Inter, system-ui', margin: '0 0 8px', color: 'rgb(95, 97, 102)' }}>{piece.name}</p>
          {piece.render(p)}
        </section>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
