import type { PermissionMode, SendState } from '../state/types';
import type { IconName } from './Icon';

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 2.7 — THE COMPOSER'S DECISIONS, WITH NO REACT AND NO DOM.
   packages/web2/src/chat/composerModel.ts

   Zero React imports, zero fetch, zero DOM. The adoption study's single most
   transferable finding is `MLH/frontend/src/lib/engine/client.ts:3-7` — the
   frontend "never contains a business rule", so every component is a renderer
   and a renderer's inputs are props. This file is where the composer's rules
   live so that the component below it holds none.

   Everything here is asserted in composerModel.test.ts.
   ══════════════════════════════════════════════════════════════════════════ */

/** The state of the keyboard when a key went down, with nothing DOM-shaped in
 *  it — so the rule can be tested without synthesising an event. */
export interface KeyContext {
  key: string;
  shiftKey: boolean;
  /** True while an IME candidate window is open. */
  composing: boolean;
}

/** What the composer does with a keystroke. `pass` means "the textarea's". */
export type KeyIntent = 'send' | 'newline' | 'pass';

/**
 * ENTER SENDS, SHIFT+ENTER NEWLINES — and Enter during composition does
 * neither of those two things it looks like it should.
 *
 * The IME clause is ported from MLH/frontend/src/components/Composer.tsx:182-192
 * and is not a nicety: an East Asian user presses Enter to ACCEPT a candidate,
 * and a composer without this check sends the half-composed message. v1 has no
 * such guard (adoption study §1.12, marked "confirmed bug"), which means the
 * product is unusable in Japanese, Chinese and Korean today.
 *
 * Note what this function does NOT decide: whether a send is currently allowed.
 * That is `deriveSendState`, and keeping them apart is why "Enter mid-stream"
 * and "Enter on an empty draft" are one rule each rather than four branches in
 * a keydown handler.
 */
export function keyIntent(ctx: KeyContext): KeyIntent {
  if (ctx.key !== 'Enter') return 'pass';
  if (ctx.composing) return 'newline';
  return ctx.shiftKey ? 'newline' : 'send';
}

/** The parts of the in-flight turn the button cares about. Narrowed to one
 *  field so the composer does not have to be handed the whole turn to know
 *  whether it is running. */
export interface InFlightPhase {
  phase: 'queued' | 'streaming' | 'finalizing' | 'stopping' | 'done' | 'error';
}

/**
 * THE SEND BUTTON'S FOUR STATES REDUCED TO THREE VALUES (focus is a ring on any
 * of the other three, not a state of its own — types.ts SendState says so).
 *
 * `running` outranks everything, including a draft typed mid-stream: sheet
 * 12.4 requires that "the control that started the work is the control that
 * ends it", so nothing the user types may turn stop back into send.
 *
 * Chips alone do not enable send. A chip is a reference, not a question, and a
 * turn that carries three node ids and no words gives the model nothing to
 * answer. Stated here rather than in the component so that changing it means
 * changing a test.
 */
export function deriveSendState(draft: string, inFlight: InFlightPhase | null): SendState {
  if (inFlight && inFlight.phase !== 'done' && inFlight.phase !== 'error') return 'running';
  return draft.trim() === '' ? 'disabled' : 'ready';
}

/**
 * The autosize cap, in pixels, given a measured `scrollHeight`.
 *
 * Four lines, per item 2.7. Past that the field scrolls rather than growing,
 * because a composer that grows without bound eats the transcript it is
 * supposed to be a reply to — and the transcript is the evidence.
 *
 * The floor exists because a textarea measured before layout reports 0, and a
 * zero-height field is one the user cannot find again.
 */
export function autosizeHeight(scrollHeight: number, lineHeight: number, maxLines: number): number {
  const cap = lineHeight * maxLines;
  return Math.max(lineHeight, Math.min(scrollHeight, cap));
}

/**
 * THE MOST-READ LINE IN THE PRODUCT.
 *
 * Sheet 12.4: "It names the one affordance a person cannot discover by looking,
 * in the one place they are guaranteed to read, and it says what the assistant
 * is grounded on in the same breath. It claims nothing else, because there is
 * nothing else: this composer has no slash commands, and a placeholder that
 * advertises one would be the product lying in its most-read line."
 *
 * The sheet also draws it changing with context — a new thread says "Ask about
 * this repo", a live thread says "Ask for a follow-up change" — so the second
 * message does not re-teach the first message's lesson.
 */
export function placeholderFor(live: boolean): string {
  const lead = live ? 'Ask for a follow-up change' : 'Ask about this repo';
  /* Decision 4 (2026-08-24) added `/`. Slash opens the command menu derived from
     the toolbelt + permission modes — NOT a skills registry. Skills live on disk
     under `.sequence/skills/` and load into asks; `/` never lists them. Naming
     "skills" here was the product lying in its most-read line; "commands" is
     what `/` actually opens. */
  return `${lead} — / for commands, @ to reference a node, a file or a function`;
}

/**
 * The ask text a toolbelt pick seeds (and sends).
 *
 * Three of the four toolbelt items change WHAT WILL BE ASKED. These strings are
 * the product's answer — not a second menu of free-text the reader must invent.
 * Chip labels, when present, narrow the focus; an empty chip list asks about
 * the whole attached graph.
 */
export function toolbeltAskText(
  id: Exclude<ToolbeltId, 'models' | 'start-workflow'>,
  chipLabels: readonly string[],
): string {
  const focus =
    chipLabels.length === 0
      ? ''
      : `Focus on ${chipLabels.join(', ')}. `;
  if (id === 'break-down') {
    return `${focus}Break down the architecture — what is inside each major system, and how do they connect? Prefer a board diagram when it helps.`;
  }
  return `${focus}What breaks if I change this — blast radius and impact across services? Prefer the board when it helps.`;
}

export type ToolbeltId = 'break-down' | 'what-breaks' | 'start-workflow' | 'models';

export interface ToolbeltItem {
  id: ToolbeltId;
  label: string;
  /** The right-hand gloss the sheet draws in mono at --t-10. */
  hint: string;
  icon: IconName;
  /** Sheet 12.4 draws one <hr>, above Models. */
  separatorBefore: boolean;
}

/**
 * ONE KEEPER LIST.
 *
 * v1 shipped three competing `+` menus — agentModeTools.ts:10-47,
 * composerModel.ts:82-108, and a Work variant — and the plan records that as a
 * defect by name in item 2.7. Three lists is three answers to "what can I do
 * here", and the user meets whichever one the surface happened to mount.
 *
 * This is the sheet's own menu, in the sheet's own order, with the sheet's own
 * glosses. The three above the rule change WHAT WILL BE ASKED; the one below it
 * changes WHO IS ASKED. No two items render the same glyph, because an icon
 * that means two things means neither (GRAPHITE-DECISIONS.md Decision 2).
 *
 * `models` opens Settings → provider (the connected reasoning config). This used
 * to add: "A submenu of alternate models has no wire source — `/api/ai-config`
 * returns one string — so the honest door is the settings pane, not a fake
 * picker." The route serves a LIST now (`profiles`), and the composer's model
 * chip is the picker; this row stays the door to MANAGING them, which is a
 * different act from choosing one.
 */
export const TOOLBELT: readonly ToolbeltItem[] = [
  { id: 'break-down', label: 'Break it down', hint: 'what is inside', icon: 'module', separatorBefore: false },
  { id: 'what-breaks', label: 'What breaks', hint: 'blast radius', icon: 'alert', separatorBefore: false },
  { id: 'start-workflow', label: 'Start a workflow', hint: 'agent run', icon: 'run', separatorBefore: false },
  { id: 'models', label: 'Reasoning', hint: 'connected', icon: 'key', separatorBefore: true },
];

/* ══════════════════════════════════════════════════════════════════════════
   SLASH COMMANDS — Decision 4 (2026-08-24)

   Sheet 12.4 used to say "this composer has no slash commands, and a
   placeholder that advertises one would be the product lying in its most-read
   line". That was true on the day it was written. Max ruled on 2026-08-24:

     "i want to introduce / commands for skills pleae add that"

   The sheet's rule was never "no slash commands" — it was that the placeholder
   claims nothing that does not exist. `/` now exists, so naming it obeys the
   rule. GRAPHITE-DECISIONS.md Decision 4 carries the quote and the scope.

   ── ONE KEEPER LIST, STILL ────────────────────────────────────────────────

   TOOLBELT above records why this file is careful here: v1 shipped THREE
   competing `+` menus, and item 2.7 names that as a defect — "three lists is
   three answers to 'what can I do here', and the user meets whichever one the
   surface happened to mount".

   A hand-written slash list would be the fourth. So the registry below is
   DERIVED: every entry points back at the toolbelt item or the permission mode
   it stands for, and `slashCommands()` builds it from those two lists at call
   time. Add a toolbelt item and it has a slash command; delete one and its
   slash command goes with it. There is nothing to keep in sync because there is
   no second copy.
   ══════════════════════════════════════════════════════════════════════════ */

/** Where a slash command comes from. There is no third kind, and no free-standing one. */
export type SlashSource =
  | { kind: 'toolbelt'; id: ToolbeltId }
  | { kind: 'mode'; mode: PermissionMode };

export interface SlashCommand {
  /** What is typed after the slash. Lowercase, no spaces — it has to be typeable. */
  name: string;
  label: string;
  hint: string;
  icon: IconName;
  source: SlashSource;
}

/** The slash name for a toolbelt item. Short enough to type, long enough to read. */
const TOOLBELT_SLASH: Record<ToolbeltId, string> = {
  'break-down': 'breakdown',
  'what-breaks': 'whatbreaks',
  'start-workflow': 'workflow',
  models: 'models',
};

/**
 * Every command `/` offers, derived from the two keeper lists.
 *
 * `modes` is passed in rather than imported so this module stays free of the
 * component that draws the permission control — the same separation the rest of
 * this file keeps, and the reason it is testable without React.
 */
export function slashCommands(
  modes: readonly { mode: PermissionMode; label: string; description: string; icon: IconName }[],
  toolbelt: readonly ToolbeltItem[] = TOOLBELT,
): SlashCommand[] {
  const fromTools = toolbelt.map((item) => ({
    name: TOOLBELT_SLASH[item.id],
    label: item.label,
    hint: item.hint,
    icon: item.icon,
    source: { kind: 'toolbelt', id: item.id } as const,
  }));
  const fromModes = modes.map((spec) => ({
    name: spec.mode.toLowerCase(),
    label: spec.label,
    /* The mode's own first sentence, not a second description written here —
       two glosses for one thing is how they drift apart. */
    hint: spec.description.split('.')[0]?.trim() ?? spec.label,
    icon: spec.icon,
    source: { kind: 'mode', mode: spec.mode } as const,
  }));
  return [...fromTools, ...fromModes];
}

/**
 * What the reader has typed after a leading slash, or null when they are not
 * asking for a command at all.
 *
 * ONLY AT THE START, and only while it is still one unbroken word. A "/" inside
 * a sentence is a path separator far more often than it is a command — this
 * product's answers and questions are full of `packages/web2/src` — and a menu
 * that opens on those would fight the reader every time they typed a path.
 */
export function slashQuery(text: string): string | null {
  const match = /^\/([a-z0-9-]*)$/i.exec(text);
  return match ? match[1].toLowerCase() : null;
}

/** The commands matching a query, exact-prefix first, then anywhere in the name or label. */
export function slashMatches(query: string, commands: readonly SlashCommand[]): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...commands];
  const rank = (c: SlashCommand): number => {
    if (c.name.startsWith(q)) return 0;
    if (c.name.includes(q)) return 1;
    if (c.label.toLowerCase().includes(q)) return 2;
    return 3;
  };
  return commands
    .map((c) => ({ c, r: rank(c) }))
    .filter((entry) => entry.r < 3)
    .sort((a, b) => a.r - b.r)
    .map((entry) => entry.c);
}
