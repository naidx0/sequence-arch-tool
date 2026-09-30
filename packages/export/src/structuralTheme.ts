/**
 * Structural Engineering theme — steel scale canvas/fills + app meaning-locked edge hues.
 * Signal orange (#F25C05) is reserved for title-block accent only, never edges.
 */
import type { DiagramTheme } from './diagramModel.js';

/**
 * Steel + signal tokens from `docs/archive/brand-v1/sequence-brand-structural.html`
 * (Structural Engineering brand book, v1). This used to cite `site/README.md`, which had not
 * carried these tokens since the site moved to Ledger and then Console; the site itself was
 * retired 2026-08-20 to `docs/archive/v1-site/`.
 */
export interface StructuralTheme extends DiagramTheme {
  /** Safety-orange fill — title rule / numeral only. */
  accent: string;
  /** Signal text on steel ground. */
  accentText: string;
  /** Panel / card ground (steel-10). */
  panelFill: string;
  /** Hairline soft (rows inside a block). */
  lineSoft: string;
  /** Dimension / decorative line colour — never body text. */
  lineDim: string;
  /** Hairline frame stroke (steel-25). */
  frameStroke: string;
}

/** Canonical Structural theme for SeqDiagram SVG export. */
export function structuralTheme(): StructuralTheme {
  return {
    canvas: '#121517',
    panelFill: '#191D20',
    nodeFill: '#21262A',
    nodeBorder: '#2E3439',
    frameStroke: '#2E3439',
    text: '#EEF1F3',
    muted: '#98A2AA',
    lineSoft: '#262B2F',
    lineDim: '#6B747C',
    accent: '#F25C05',
    accentText: '#FF8A3D',
    edge: {
      http: '#5aa9ff',
      grpc: '#a78bfa',
      queue: '#ffd426',
      queue_publish: '#ffd426',
      queue_consume: '#ffd426',
      db: '#30d158',
      db_access: '#30d158',
      import: '#98A2AA',
      call: '#C6CDD3',
      control: '#6B747C',
    },
    arrowhead: '#6B747C',
    fontSans:
      'Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",sans-serif',
    fontMono: '"Cascadia Mono",ui-monospace,"SF Mono","JetBrains Mono",monospace',
  };
}
