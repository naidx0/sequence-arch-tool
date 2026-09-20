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
/*
 * ── THE LABEL IS THE WHOLE ROW NOW (owner, 2026-09-19) ────────────────────
 *
 * "It should be icon plus name, smaller buttons, easier to use, easier to
 * see… the warning symbol — so it's like blast radius. Make sure it's a clear
 * name. That's all you really need."
 *
 * Every menu that draws these rows draws ONE LINE: the glyph and the label.
 * `hint` is still here and is still the sheet's gloss, but it is now the row's
 * `title` rather than a second line under it — a description that is read once
 * and then re-read on every open is a row that is twice as tall for ever in
 * exchange for a sentence nobody needs after the first time.
 *
 * `what-breaks` takes the gloss as its NAME. "What breaks" beside a warning
 * triangle reads as an error the product is reporting, not as a question a
 * reader can ask; "Blast radius" is the term for the thing and it cannot be
 * misread as an alarm.
 */
export const TOOLBELT: readonly ToolbeltItem[] = [
  { id: 'break-down', label: 'Break it down', hint: 'what is inside', icon: 'module', separatorBefore: false },
  { id: 'what-breaks', label: 'Blast radius', hint: 'what breaks if this changes', icon: 'alert', separatorBefore: false },
  { id: 'start-workflow', label: 'Start a workflow', hint: 'agent run', icon: 'run', separatorBefore: false },
  { id: 'models', label: 'Reasoning', hint: 'connected', icon: 'key', separatorBefore: true },
];

/**
 * THE MODEL'S NAME ON THE COMPOSER ROW, CUT TO WHAT THE ROW CAN SPEND.
 *
 * Owner, 2026-09-19: "the agent, aka the sub-agent, plus the model attached —
 * maybe rendering five characters, and the rest is hidden behind a dot dot
 * dot, which we can hover over to see in full." Then, the same day, having
 * looked at five: "allow for more length with model nickname, maybe around
 * 8-10 characters?" NINE, which is the middle of the range he named and the
 * point where the two models on his own machine — `minicpm5-hermes` and
 * `granite42-hermes` — stop reading as the same word.
 *
 * A JS CUT AND NOT A CSS ELLIPSIS, and the difference is the point. `max-width`
 * plus `text-overflow` gives a chip whose width depends on the name it happens
 * to hold, so the row's three controls land in a different place for every
 * model — and the bar the reader aims at moves when they switch. A character
 * count gives every model the same chip.
 *
 * The full name is never lost: it is the control's `title` and its accessible
 * name, which is where a truncation is allowed to put what it cut.
 */
export const MODEL_CHIP_CHARS = 9;

export function chipLabel(text: string, max: number = MODEL_CHIP_CHARS): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  /* Trailing space before the ellipsis reads as a typo, so the cut is trimmed
     again before the mark is added. */
  return `${clean.slice(0, max).trimEnd()}…`;
}

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

/**
 * Where a slash command comes from.
 *
 * TWO KINDS WERE DERIVED; THE THIRD IS A SESSION FIELD, and it is here for a
 * reason the owner gave on 2026-09-17, walking the installed app: "I don't like
 * that it sets the goal automatically. The goal should be a skill you call by
 * doing /goal or something, and invoking it begins this long-running task."
 *
 * `goal` is not a toolbelt row and not a permission mode — it is the session's
 * own `goal` field plus the run that works it down, so neither keeper list can
 * derive it. It is still not a free-standing FOURTH MENU: it is one more entry
 * in the ONE registry this function returns, offered only to a surface that can
 * actually perform it (see the `goal` option on `slashCommands`), because a row
 * that cannot do what it says is the defect item 2.7 records, not a feature.
 */
/**
 * THE THREE MODES THE COMPOSER OFFERS.
 *
 * Teach is not a `PermissionMode`: on the wire it is its own flag, because it
 * refuses every mutating tool by itself and no permission value has to change
 * for it (`PermissionControl.tsx` states this at length). To the person
 * choosing, it is the third mode — and typing `/` and not finding it there is
 * what the owner met on 2026-09-19: "when you go to slash mode, you can't
 * really find Teach anywhere, which is kind of annoying."
 *
 * So the palette takes the COMPOSER's mode list, not the permission list. The
 * wire distinction is real and stays where it belongs, in `pickMode`.
 */
export type ComposerMode = PermissionMode | 'teach';

export type SlashSource =
  | { kind: 'toolbelt'; id: ToolbeltId }
  | { kind: 'mode'; mode: ComposerMode }
  | { kind: 'goal' }
  /** A skill on disk under `.sequence/skills/<slug>/SKILL.md`. */
  | { kind: 'skill'; slug: string };

/**
 * WHICH SHELF A COMMAND SITS ON (owner, 2026-09-19, with a reference shot of
 * a palette headed Skills / Commands / Modes).
 *
 * One flat list was right while there were eight commands. Skills are written
 * by the person and by the agent's own distill pass, so the list grows without
 * anybody deciding to grow it — and an unsectioned list of fifty is a list
 * nobody reads. The group is a property of the SOURCE, so it cannot be set
 * wrongly by hand: every command already knows where it came from.
 */
export type SlashGroup = 'skills' | 'commands' | 'modes';

export function slashGroupOf(source: SlashSource): SlashGroup {
  if (source.kind === 'skill') return 'skills';
  if (source.kind === 'mode') return 'modes';
  return 'commands';
}

/** The heading each shelf carries, in the order the palette draws them. */
export const SLASH_GROUP_ORDER: readonly SlashGroup[] = ['skills', 'commands', 'modes'];

export const SLASH_GROUP_LABEL: Record<SlashGroup, string> = {
  skills: 'Skills',
  commands: 'Commands',
  modes: 'Modes',
};

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
  modes: readonly { mode: ComposerMode; label: string; description: string; icon: IconName }[],
  toolbelt: readonly ToolbeltItem[] = TOOLBELT,
  /**
   * `goal: true` adds `/goal`. OFF BY DEFAULT, and that is the honest default:
   * only a surface that owns a session goal and a goal run can carry out the
   * command, and `chat/Composer.tsx` owns neither. Offering it there would put
   * a row in the menu that does nothing when picked — which is worse than not
   * offering it, because the reader has then been told the product can do
   * something it cannot.
   */
  options: {
    goal?: boolean;
    /**
     * The skills this workspace has on disk (`GET /api/skills`). Passed in
     * rather than fetched, for the same reason `modes` is: this module stays
     * free of the wire and stays testable without one.
     */
    skills?: readonly { slug: string; name: string; description: string }[];
  } = {},
): SlashCommand[] {
  const fromGoal: SlashCommand[] = options.goal
    ? [
        {
          name: 'goal',
          label: 'Goal',
          /* What it DOES, not what it is: `/goal <text>` is the long-running
             task starting, and the hint is the only place that says so before
             the reader presses Enter. */
          hint: 'set it and start working',
          icon: 'target',
          source: { kind: 'goal' },
        },
      ]
    : [];
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
  /*
   * A SKILL IS TYPED BY ITS SLUG, because the slug is what the directory is
   * called and what the agent's own loader keys on — a second naming here
   * would be a second answer to "which skill is that". Two skills cannot share
   * a slug (they are directories), so the names cannot collide.
   */
  const fromSkills = (options.skills ?? []).map((sk) => ({
    name: sk.slug.toLowerCase(),
    label: sk.name,
    hint: sk.description,
    icon: 'book' as IconName,
    source: { kind: 'skill', slug: sk.slug } as const,
  }));
  return [...fromSkills, ...fromGoal, ...fromTools, ...fromModes];
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

/**
 * A slash command THAT CARRIES AN ARGUMENT — `/goal ship the parser guard`.
 *
 * `slashQuery` above deliberately stops matching the moment a space is typed,
 * because its job is to decide whether a MENU is open, and a menu that stayed
 * open while the reader wrote a sentence would own Enter for the whole
 * sentence. That is the right rule for the menu and the wrong one for the
 * invocation: `/goal <text>` is a command whose whole point is the text after
 * it, and something has to read it.
 *
 * So this is the second reader, not a replacement: `slashQuery` answers "is a
 * menu open", this answers "what did they invoke, and with what". A bare
 * `/goal` comes back with an empty `rest`, which is how the caller tells
 * "start this goal" from "open the form".
 *
 * Anchored at the start for the same reason `slashQuery` is: `packages/web2`
 * must never be a command. Case-folded on the NAME only — the argument is the
 * reader's own words and is returned exactly as typed, trimmed.
 */
export function slashInvocation(text: string): { name: string; rest: string } | null {
  const match = /^\/([a-z0-9-]+)(?:[ \t]+([\s\S]*))?$/i.exec(text);
  if (!match) return null;
  return { name: match[1].toLowerCase(), rest: (match[2] ?? '').trim() };
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

/* ══════════════════════════════════════════════════════════════════════════
   THE PALETTE'S SHELVES — Decision 35

   Owner, 2026-09-19, with a reference shot: Skills over Commands over Modes,
   three rows each, then "Show 44 more".

   ── WHY A PURE FUNCTION AND NOT A `useMemo` IN THE POPOVER ────────────────

   The same argument `goalRunVerdict.ts` makes about stop reasons. The rule
   that decides WHICH rows a reader is shown can only be checked by rendering
   the component if it lives in the component, so the cases nobody thinks to
   render are the cases nobody checks — and those are the ones that matter
   here: the shelf with exactly the cap on it, the shelf with one over, the
   search that empties a shelf entirely.

   ── THE COUNT IS THE POINT ────────────────────────────────────────────────

   "Show 44 more" and "Show more" are different sentences. The first tells a
   reader whether it is worth opening; the second asks them to find out. So
   `hidden` is a number, and a shelf with nothing hidden reports zero rather
   than being given a row that says so.
   ══════════════════════════════════════════════════════════════════════════ */

/** Rows per shelf before the rest go behind a count. Three, as the shot shows. */
export const SLASH_SECTION_PREVIEW = 3;

export interface SlashSection {
  group: SlashGroup;
  label: string;
  /** The rows to draw now — the whole shelf when `expanded`, else the preview. */
  items: SlashCommand[];
  /** How many this shelf is holding back. Zero when it is showing everything. */
  hidden: number;
}

/**
 * Shelve the matches, in the fixed group order, capped unless expanded.
 *
 * AN EMPTY SHELF IS NOT DRAWN. A heading with no rows under it is a promise
 * the list does not keep, and while the reader is typing most shelves empty.
 *
 * A SEARCH SHOWS EVERYTHING IT MATCHED. `query` being non-empty means the
 * reader has already narrowed the list themselves; capping it again would hide
 * the very row they typed toward — the failure the cap exists to prevent, in
 * reverse.
 */
export function slashSections(
  matches: readonly SlashCommand[],
  options: { expanded?: ReadonlySet<SlashGroup>; searching?: boolean; preview?: number } = {},
): SlashSection[] {
  const preview = options.preview ?? SLASH_SECTION_PREVIEW;
  const out: SlashSection[] = [];
  for (const group of SLASH_GROUP_ORDER) {
    const all = matches.filter((c) => slashGroupOf(c.source) === group);
    if (all.length === 0) continue;
    const whole = options.searching === true || options.expanded?.has(group) === true;
    /* A SHELF ONE ROW OVER THE CAP SHOWS THAT ROW. "Show 1 more" spends a row
       to hide a row and charges a click for the trade, which is the cap doing
       the opposite of its job (owner, 2026-09-19: the menu "shouldn't auto
       default to showing a bunch of things", and a count that hides one thing
       is not what that asks for). */
    const items = whole || all.length <= preview + 1 ? all : all.slice(0, preview);
    out.push({
      group,
      label: SLASH_GROUP_LABEL[group],
      items,
      hidden: all.length - items.length,
    });
  }
  return out;
}

/**
 * The rows a reader can arrow through, in the order they are drawn.
 *
 * The palette's keyboard index counts VISIBLE rows, and the shelves decide
 * what is visible — so the flattening has to come from the same call that
 * produced them, or the highlight lands on a row that is not on screen.
 */
export function slashVisible(sections: readonly SlashSection[]): SlashCommand[] {
  return sections.flatMap((s) => s.items);
}
