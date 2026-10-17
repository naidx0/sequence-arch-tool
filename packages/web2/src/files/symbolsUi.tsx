import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   FUNCTIONS UNDER A FILE (I6, P5 option A)
   packages/web2/src/files/symbolsUi.tsx

   A file the function index knows lists its functions beneath it; clicking one
   plays its traced flow on the Architecture board (rail/railModel
   `flowForFunction`, the canvas `canvas/flow` action). Only what
   GET /api/functions returned is listed: no provider, or a file with no
   functions, and the tree is exactly today's.

   A context, like branchUi, so FileTree and FilesPanel keep their props.
   ══════════════════════════════════════════════════════════════════════════ */

export interface SymbolEntry {
  id: string;
  name: string;
  line: number;
}

export interface SymbolsUi {
  /** Repo path -> the functions the server returned for that file, in source order. */
  byFile: ReadonlyMap<string, readonly SymbolEntry[]>;
  /** Files whose function list is open. */
  open: ReadonlySet<string>;
  onToggle: (path: string) => void;
  /** A function was clicked: play its flow. */
  onPlay: (id: string) => void;
  /** The function whose flow is on the board now. */
  playingId: string | null;
  /** A function the scan could not trace beyond its own file (the honest "Not traced"). */
  untracedId: string | null;
  /** The flow strip (rail/FlowPanel), drawn under the tree while a flow is chosen. */
  footer?: ReactNode;
}

export const SymbolsUiContext = createContext<SymbolsUi | null>(null);

export function useSymbolsUi(): SymbolsUi | null {
  return useContext(SymbolsUiContext);
}
