/**
 * RECOMMENDED AGENT CLI VERSIONS (0.1.8.4).
 *
 * "Update available" must be knowable offline and must never block the app, so it is
 * not a network lookup: it is the version each CLI was last checked against, kept here
 * and bumped per release. An installed CLI below it is still Ready (the hard floor is
 * MIN_CLAUDE_VERSION in claudeCli.ts, state `update`); it just gets a calm Update button.
 *
 *   claude  2.1.293  the Agent SDK in the bundled bridge pins this (claudeCli.ts)
 *   codex   0.153.4  the version the codex probe and run fixtures were measured on
 *
 * The update itself is the vendor's own installer re-run through cliInstall.ts on a
 * person's click. `command` is the vendor's documented manual command, shown to copy
 * when the button fails or the old binary still wins on PATH.
 */
import { compareVersions } from './claudeCli.js';

export interface UpdateAvailable {
  /** The version Sequence recommends. */
  recommended: string;
  /** The documented manual update command, to copy. */
  command: string;
}

const RECOMMENDED: Readonly<Record<string, UpdateAvailable>> = {
  claude: { recommended: '2.1.293', command: 'claude update' },
  codex: { recommended: '0.153.4', command: 'npm install -g @openai/codex@latest' },
};

/** The update note for an installed CLI, or null when it is current, unknown or unreadable. Pure. */
export function updateAvailableFor(id: string, version: string | null): UpdateAvailable | null {
  const rec = RECOMMENDED[id];
  if (!rec || !version) return null;
  return compareVersions(version, rec.recommended) < 0 ? { ...rec } : null;
}
