/* ══════════════════════════════════════════════════════════════════════════
   AN AGENT'S NAME IS THE LABEL IT WAS REGISTERED WITH
   packages/web2/src/agents/agentLabels.ts

   The Opus walk of 2026-10-15: "The registered `label` is ignored ('Goal agent (fake, tick)' shows as 'Goal')". The
   server keeps a `label` for each registered agent (GET /api/acp/agents, agents.json); the page named an agent from
   its id alone. The label is what the person wrote down, so it wins; a label that only repeats the id says nothing
   and falls back to the vendor's name, then to the id with a capital.
   ══════════════════════════════════════════════════════════════════════════ */

/** The names the vendors use; any other agent is its id, capitalised. */
const VENDOR_NAMES: Readonly<Record<string, string>> = { claude: 'Claude Code', codex: 'Codex' };

export function agentDisplayName(ref: string, labels?: Readonly<Record<string, string>>): string {
  const label = labels?.[ref]?.trim();
  if (label && label.toLowerCase() !== ref.toLowerCase()) return label;
  return VENDOR_NAMES[ref] ?? ref.charAt(0).toUpperCase() + ref.slice(1);
}

/** The labels in a GET /api/acp/agents answer, by agent id (only the ones that say something). */
export function labelsOf(agents: readonly { id: string; label?: unknown }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of agents) if (typeof a.label === 'string' && a.label.trim() !== '' && a.label.trim().toLowerCase() !== a.id.toLowerCase()) out[a.id] = a.label.trim();
  return out;
}
