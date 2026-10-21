/* ══════════════════════════════════════════════════════════════════════════
   ACCESS MODES — what Sequence's mode means to the agent it drives
   packages/acp/src/accessMode.ts

   Owner, 2026-10-05: full access = skip permissions, with clear build-mode
   switches and no needless permission locks.

   The build spec's table, and the only place it is written down in code:

     Sequence label | AgentMode | Claude Code                         | Codex
     Ask            | propose   | permissionMode default              | on-request + read-only
     Auto-edit      | autoEdit  | acceptEdits                         | on-request + workspace-write
     Full access    | full      | bypassPermissions                   | never + danger-full-access
                    |           |  + allowDangerouslySkipPermissions  |

   `plan` rides along: Claude's own `plan` mode; Codex on-request + read-only
   (the same dials as Ask) plus codex's own plan mode (collaborationMode plan,
   codexAppServer.ts), or the same minus collaborationMode where codex does not
   offer it. Not `untrusted`: measured live 2026-10-06 (lab/codex-live-gate.md),
   `untrusted` put every harmless read in front of the person while Ask ran the
   same reads freely. The read-only sandbox is what keeps a plan from writing.

   THREE ROUTES TO THE AGENT, because agents are launched three ways:
     - a Claude ACP adapter (claude-agent-acp / claude-code-acp) reads
       `_meta.claudeCode.options` on session/new;
     - any agent that advertises session modes is switched with session/set_mode;
     - a plain CLI or codex-acp takes flags / `-c` config overrides on argv.

   PURE. No transport and no process: the client applies these.
   ══════════════════════════════════════════════════════════════════════════ */

import { allowsTool, type AgentMode } from './planMode.js';

/** How a registered agent is launched — decides which route carries the mode. */
export type AgentKind = 'claude-acp' | 'codex-acp' | 'claude-cli' | 'codex-cli' | 'other';

/** Claude Agent SDK options, passed as `_meta.claudeCode.options` (claude-agent-acp convention). */
export interface ClaudeCodeOptions {
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  /** Required by the Claude Agent SDK alongside `bypassPermissions`. */
  allowDangerouslySkipPermissions?: true;
}

/** Codex's two independent dials. */
export interface CodexOptions {
  approvalPolicy: 'untrusted' | 'on-request' | 'never';
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
}

export function claudeOptionsFor(mode: AgentMode): ClaudeCodeOptions {
  switch (mode) {
    case 'plan':
      return { permissionMode: 'plan' };
    case 'propose':
      return { permissionMode: 'default' };
    case 'autoEdit':
      return { permissionMode: 'acceptEdits' };
    case 'full':
      return { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true };
  }
}

export function codexOptionsFor(mode: AgentMode): CodexOptions {
  switch (mode) {
    case 'plan':
    case 'propose':
      return { approvalPolicy: 'on-request', sandbox: 'read-only' };
    case 'autoEdit':
      return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
    case 'full':
      return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
  }
}

/**
 * PLAN MAKES NO CHANGES (owner ruling, 2026-10-06; widened round 11). A write
 * the agent asks to make while in Plan is declined at once: no card, no
 * prompt, one quiet line in the chat (PLAN_REFUSAL). "A write" is every kind
 * `allowsTool('plan', kind)` refuses (edit, delete, move, execute, other, and
 * any kind this build has never heard of), so a command or a sandbox
 * escalation is refused too, never offered as an Allow card.
 *
 * Only an explicit `switch_mode` (Claude's "Ready to code?" exit from its
 * plan, which the person must answer) keeps its own handling. A request with
 * NO kind is refused too: codex-acp sends its sandbox escalations ("File
 * System Write Access", "Network Access") and MCP elicitations without one,
 * and approving such a card let the write through. Nothing to judge it by
 * means it is not shown as an Allow card in Plan.
 */
export function planRefuses(mode: AgentMode, kind: string | null | undefined): boolean {
  if (mode !== 'plan') return false;
  if (kind === 'switch_mode') return false;
  if (!kind) return true;
  return !allowsTool('plan', kind);
}

/** The line the chat shows for a refused Plan edit. */
export const PLAN_REFUSAL = "Plan mode doesn't make changes. Approve the plan or switch mode to apply it.";

/**
 * PLAN ASKS THROUGH THE TOOL. A live Plan turn asked its clarifying question
 * as plain text, so the person got no card. In Plan only, codex's thread
 * carries one developer instruction (ThreadStartParams / ThreadResumeParams
 * .developerInstructions, added to the thread, not replacing codex's own) to
 * ask with request_user_input instead. Nothing touches the user's codex config.
 */
export const PLAN_ASK_INSTRUCTION =
  'When you need a decision from the person, ask with the request_user_input tool, giving 2 to 4 options, instead of asking in plain text.';

/** The developer instructions codex's thread is opened with in `mode`, or null for none. */
export function codexDeveloperInstructionsFor(mode: AgentMode): string | null {
  return mode === 'plan' ? PLAN_ASK_INSTRUCTION : null;
}

/**
 * YOU CAN DRAW IN THE CHAT (T3 gap, lane visual). One line of instruction for
 * every agent kind (Claude via `_meta.systemPrompt.append`, codex via
 * `developerInstructions`): a fenced svg or html block is shown to the person
 * as a picture, not as code. Idea after T3 Code's inline html_render (MIT).
 */
const DRAW_BASE =
  'You can show the person a picture or a small demo right in the chat: write a fenced ```svg block (one complete <svg>) or a ```html block (one self-contained page with inline <style> and <script>; it runs sandboxed with no network, so use no external URLs). It is drawn once the block is closed, in the app theme (CSS variables --seq-bg, --seq-fg, --seq-muted, --seq-accent, --seq-edge, --seq-surface). Keep it under about 100 KB; use it only when a picture explains better than words. Each is saved as d1, d2, ...: the drawings tool lists and reads them, and a person may cite one as @drawing:d3. To change one, write ```svg id=d3 (or ```html id=d3) with the whole new source: it becomes a new version. For charts, forecasts, load or capacity, latency and flow, sequence or timeline diagrams do not hand-write svg: call the visual tool (list:true names the components, help:"line" gives a spec), then show it with a ```visual block holding {"id":"d5"}; without the tool write {"component":"line","spec":{...}} in the ```visual block.';

/**
 * HOW TO DRAW WELL (0.1.5, the owner: "the drawings are so-so: better guidelines, better examples"; "force the
 * drawings to be more vertical than horizontal"). The chat column is about 440 px wide. Short on purpose: it rides
 * on every turn. A test holds the key lines and checks that every example here is valid.
 */
export const DRAWING_RULES = [
  'DRAWING RULES. The chat column is about 440 px wide and any height is fine, so draw tall, not wide.',
  '1. Top to bottom, always: flows, steps, timelines and architecture stack downward. Never more than 3 boxes in a row; a wider picture is split or stacked.',
  '2. svg: viewBox width 420 (never over 480), no fixed width or height; at most 8 boxes; boxes at least 120x40 with 24 px between rows.',
  '3. Short labels: 1 to 4 words per box (28 characters at most), text-anchor="middle" at the box centre, 12 to 14 px and never under 11; no text over text or on a border; an arrow label goes beside its arrow in clear space.',
  '4. One idea per picture and one title (the svg <title>); the app shows it centred, so do not draw it again.',
  '5. For flows, sequences, timelines and charts use the visual tool: it lays them out top down and fits the words.',
  '6. Style: no emoji or pictographs. Colours only from the theme variables above, one accent use at most; 1 px hairlines; rx 8 boxes; font inherit; no gradients or shadows.',
  '7. html: only kit classes: seq-card, seq-btn (seq-btn primary: at most one, interactive demos only), seq-chip, seq-row, seq-stack, seq-muted. No own <style>, inline colours, gradients, shadows or custom fonts. Prefer text and chips to buttons.',
  '8. Components: our kit first, then UIArc.dev for new ones; anything else, search shadcn first. Icons likewise.',
].join('\n');

/** Five examples the model copies the shape of: a flow, a sequence and a chart for the visual block, a hand-written svg and a kit html card. */
export const DRAWING_EXAMPLES = [
  'Examples. Flow: {"component":"flow","spec":{"title":"Request path","nodes":[{"id":"c","label":"Client"},{"id":"g","label":"Gateway","sub":"auth, quota"},{"id":"m","label":"Model"}],"edges":[{"from":"c","to":"g","label":"HTTPS"},{"from":"g","to":"m"}]}}',
  'Sequence: {"component":"sequence","spec":{"title":"Ask","actors":["App","API","DB"],"messages":[{"from":"App","to":"API","text":"POST /ask"},{"from":"API","to":"DB","text":"insert"}]}}',
  'Chart: {"component":"bar","spec":{"title":"p95 by route","categories":["/ask","/plan"],"series":[{"name":"ms","values":[420,310]}]}}',
  'svg: <svg viewBox="0 0 420 126" font-size="13" text-anchor="middle"><title>Plan</title><rect x="110" y="6" width="200" height="40" rx="8" fill="none" stroke="currentColor"/><text x="210" y="31">Read the code</text><path d="M210 46v28m-5-6 5 6 5-6" fill="none" stroke="currentColor"/><rect x="110" y="80" width="200" height="40" rx="8" fill="none" stroke="currentColor"/><text x="210" y="105">Write the fix</text></svg>',
  'html: <div class="seq-card seq-stack"><b>Deploy</b><span class="seq-muted">Two checks left.</span><div class="seq-row"><span class="seq-chip">api</span><span class="seq-chip">ready</span></div></div>',
].join('\n');

export const DRAW_INSTRUCTION = [DRAW_BASE, DRAWING_RULES, DRAWING_EXAMPLES].join('\n\n');

/** Codex's developer instructions for `mode`: the mode's own line (Plan asks through the tool) then the drawing line. */
export function codexThreadInstructionsFor(mode: AgentMode): string {
  const own = codexDeveloperInstructionsFor(mode);
  return own ? `${own}\n\n${DRAW_INSTRUCTION}` : DRAW_INSTRUCTION;
}

/** Argv to append when launching an agent of `kind` in `mode`. Unknown agents get none. */
export function cliArgsFor(kind: AgentKind, mode: AgentMode): string[] {
  if (kind === 'claude-cli') {
    return mode === 'full'
      ? ['--dangerously-skip-permissions']
      : ['--permission-mode', claudeOptionsFor(mode).permissionMode];
  }
  if (kind === 'codex-cli') {
    /* `-c approval_policy=`, NOT `--ask-for-approval`. The flags are appended
       after the configured args, i.e. after `exec`, and in codex 0.153.4
       `--ask-for-approval` is a top-level option only: `codex exec ...
       --ask-for-approval X` exits 2 with "unexpected argument". `-c` and
       `--sandbox` are accepted both at top level and by `exec`. */
    const c = codexOptionsFor(mode);
    return ['-c', `approval_policy=${c.approvalPolicy}`, '--sandbox', c.sandbox];
  }
  if (kind === 'codex-acp') {
    const c = codexOptionsFor(mode);
    return ['-c', `approval_policy=${c.approvalPolicy}`, '-c', `sandbox_mode=${c.sandbox}`];
  }
  return [];
}

/**
 * The ACP session-mode ids that mean `mode`, Claude's id first, then codex-acp's.
 * The client picks the first one the agent actually advertises.
 */
export function sessionModeIdsFor(mode: AgentMode): string[] {
  switch (mode) {
    case 'plan':
      return ['plan', 'read-only'];
    case 'propose':
      return ['default', 'read-only'];
    case 'autoEdit':
      return ['acceptEdits', 'auto'];
    case 'full':
      return ['bypassPermissions', 'full-access'];
  }
}

/** Classify a launch by its binary name (and, for `npx`-style launches, its package arg). */
export function agentKindOf(launch: { command: string; args?: string[] }): AgentKind {
  const words = [launch.command, ...(launch.args ?? [])].map((w) => w.toLowerCase());
  if (words.some((w) => /claude-(agent|code)-acp/.test(w))) return 'claude-acp';
  if (words.some((w) => /codex-acp/.test(w))) return 'codex-acp';
  const base = (launch.command.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
  if (base === 'claude') return 'claude-cli';
  if (base === 'codex') return 'codex-cli';
  /* The npm package's own entry run with node (`node .../@openai/codex/bin/codex.js`),
     which is how the plain CLI launches on Windows without its .cmd shim. */
  const first = (launch.args?.[0]?.split(/[\\/]/).pop() ?? '').toLowerCase();
  if (/^node(\.exe)?$/.test(base) && /^codex\.(js|mjs|cjs)$/.test(first)) return 'codex-cli';
  /* 0.1.5 G1: the same entry run by the app's own executable (no node beside the shim or on PATH,
     so Sequence.exe as node). The package path makes it codex, not the runner's name. */
  if (/[\\/]@openai[\\/]codex[\\/]bin[\\/]codex\.(js|mjs|cjs)$/i.test(launch.args?.[0] ?? '')) return 'codex-cli';
  return 'other';
}

/** The text an agent-side bypass refusal is explained with when the agent gives none. */
export const BYPASS_UNAVAILABLE_HINT =
  'Claude Code hides bypass mode when it runs as root without IS_SANDBOX=1, ' +
  'or when a managed policy sets disableBypassPermissionsMode.';

/**
 * The agent would not enter the requested mode. Carries the agent's OWN reason.
 * Never caught and downgraded: a caller that asked for full access and silently
 * got Ask would believe the agent can act when it cannot.
 */
export class AccessModeRefusedError extends Error {
  readonly mode: AgentMode;
  readonly reason: string;
  constructor(mode: AgentMode, reason: string) {
    super(`The agent refused ${mode === 'full' ? 'full access' : `${mode} mode`}: ${reason}`);
    this.name = 'AccessModeRefusedError';
    this.mode = mode;
    this.reason = reason;
  }
}

/** The most specific message in a thrown JSON-RPC error (`data.details` first). */
export function agentErrorReason(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; data?: unknown };
    const data = o.data as { details?: unknown; message?: unknown } | string | undefined;
    if (typeof data === 'string' && data !== '') return data;
    if (data && typeof data === 'object') {
      if (typeof data.details === 'string' && data.details !== '') return data.details;
      if (typeof data.message === 'string' && data.message !== '') return data.message;
    }
    if (typeof o.message === 'string' && o.message !== '') return o.message;
  }
  return String(e);
}
