/* ══════════════════════════════════════════════════════════════════════════
   A VENDOR'S MARK, OR ITS INITIAL
   packages/web2/src/settings/logos/BrandMark.tsx

   The real mark of an agent (ACP registry) or a model provider (models.dev),
   drawn in currentColor inside the 32px tile the Settings rows already use
   (.sb-agent-ic), so it follows the text tokens in every theme. The geometry
   is packaged, sanitised data (agentMarks.ts, providerMarks.ts; SOURCES.md
   says where each came from): rendering never fetches. Claude, Codex and
   OpenAI keep the marks the Coding agents rows already draw (ProviderIcon,
   shell2/brand, @lobehub/icons-static-svg). A vendor with no mark gets its
   first letter in the same tile (.sb-catalog-ic).
   ══════════════════════════════════════════════════════════════════════════ */

import { ProviderIcon, type ProviderKey } from '../../shell2/brandIcons';
import type { Mark } from './mark';

/* Ids (agent, memory or provider) whose mark the app already ships, vetted, in shell2/brand. */
const VETTED: Readonly<Record<string, ProviderKey>> = { claude: 'claude', 'claude-acp': 'claude', anthropic: 'claude', codex: 'codex', 'codex-acp': 'codex', openai: 'openai' };

/** `tile` and `monoTile` let another surface (the welcome screen) draw the same mark in its own tile. */
export function BrandMark({ id, mark, name, tile = 'sb-agent-ic', monoTile = 'sb-agent-ic sb-catalog-ic' }: { id?: string; mark: Mark | undefined; name: string; tile?: string; monoTile?: string }) {
  const vetted = id ? VETTED[id] : undefined;
  if (vetted) {
    return (
      <span className={tile} data-mark="logo" aria-hidden="true">
        <ProviderIcon provider={vetted} />
      </span>
    );
  }
  if (!mark) {
    return (
      <span className={monoTile} data-mark="monogram" aria-hidden="true">
        {name.trim().slice(0, 1).toUpperCase() || '?'}
      </span>
    );
  }
  const [viewBox, shapes, rootFill] = mark;
  return (
    <span className={tile} data-mark="logo" aria-hidden="true">
      {/* Packaged, sanitised path data from build-marks.mjs, never user content. */}
      <svg viewBox={viewBox} fill={rootFill === 'none' ? 'none' : 'currentColor'} focusable="false" dangerouslySetInnerHTML={{ __html: shapes }} />
    </span>
  );
}
