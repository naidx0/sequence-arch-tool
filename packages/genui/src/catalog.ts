/**
 * THE CATALOG: every component an agent may emit, its props as a strict zod schema,
 * which children it accepts, and a one-line description that becomes the agent's
 * prompt. Nothing outside the catalog renders: an unknown type is a validation error
 * the repair loop fixes or replaces, never arbitrary markup (the guardrail json-render,
 * A2UI and ChatGPT's DIL primitives all share).
 *
 * Props are `.strict()` so a misspelt prop is reported instead of silently ignored, and
 * every enum is small and semantic (tone, status) so the design rules live in the
 * renderer, not in what the model happens to write.
 */
import { z } from 'zod';

export const Tone = z.enum(['neutral', 'info', 'success', 'warning', 'danger', 'accent', 'merged']);
export const StepStatus = z.enum(['pending', 'running', 'done', 'warning', 'error', 'skipped']);
export const CheckStatus = z.enum(['pending', 'running', 'pass', 'fail']);
export const ActionRef = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/, 'lowercase action name, e.g. "run_tests"'),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const text = z.string().max(2000);
const label = z.string().min(1).max(160);

export type ChildRule = 'none' | 'any' | readonly string[];

export interface ComponentDef {
  props: z.ZodType<Record<string, unknown>>;
  children: ChildRule;
  description: string;
  /** One example element (props only), shown in the prompt and in help. */
  example: Record<string, unknown>;
}

const def = (d: ComponentDef): ComponentDef => d;

export const CATALOG = {
  Card: def({
    description: 'The surface frame: a titled card. Usually the root. badge shows state top-right.',
    props: z.object({ title: label, subtitle: text.optional(), badge: z.string().max(40).optional(), tone: Tone.optional() }).strict(),
    children: 'any',
    example: { title: 'Upgrade auth middleware', badge: 'Open', tone: 'success' },
  }),
  Stack: def({
    description: 'Lays children out in a row or a column.',
    props: z.object({ direction: z.enum(['row', 'column']).default('column'), gap: z.number().int().min(0).max(6).optional(), align: z.enum(['start', 'center', 'end', 'stretch']).optional(), wrap: z.boolean().optional() }).strict(),
    children: 'any',
    example: { direction: 'row', gap: 2 },
  }),
  Heading: def({
    description: 'A section heading.',
    props: z.object({ text: label, level: z.number().int().min(1).max(3).optional() }).strict(),
    children: 'none',
    example: { text: 'Changes', level: 2 },
  }),
  Text: def({
    description: 'A paragraph. tone muted for secondary text; mono for code-like text.',
    props: z.object({ text, tone: Tone.optional(), muted: z.boolean().optional(), mono: z.boolean().optional() }).strict(),
    children: 'none',
    example: { text: 'Lena rotated the signing key on main; it touches the same lines.', muted: true },
  }),
  Badge: def({
    description: 'A small status label.',
    props: z.object({ label: z.string().min(1).max(40), tone: Tone.default('neutral') }).strict(),
    children: 'none',
    example: { label: '3 conflicts', tone: 'warning' },
  }),
  StatusLine: def({
    description: 'One live line of what is happening now, with a spinner while busy.',
    props: z.object({ text: label, busy: z.boolean().optional() }).strict(),
    children: 'none',
    example: { text: 'Pushing 3 commits to origin', busy: true },
  }),
  Timeline: def({
    description: 'A vertical sequence of steps. Children are TimelineItem.',
    props: z.object({}).strict(),
    children: ['TimelineItem'],
    example: {},
  }),
  TimelineItem: def({
    description: 'One step. status drives the node colour; children (Progress, Text, Diff) nest under it.',
    props: z.object({ title: label, status: StepStatus, detail: text.optional(), meta: z.string().max(60).optional(), tone: Tone.optional() }).strict(),
    children: 'any',
    example: { title: 'Run tests', status: 'running', meta: '12s' },
  }),
  Progress: def({
    description: 'A determinate bar with a live count: value of max.',
    props: z.object({ label: z.string().max(120).optional(), value: z.number().min(0), max: z.number().positive(), tone: Tone.optional() }).strict(),
    children: 'none',
    example: { label: 'Tests', value: 36, max: 42 },
  }),
  Metric: def({
    description: 'A big number with a label and an optional delta.',
    props: z.object({ label, value: z.union([z.number(), z.string().max(40)]), delta: z.string().max(20).optional(), tone: Tone.optional() }).strict(),
    children: 'none',
    example: { label: 'Coverage', value: '84%', delta: '+2.1', tone: 'success' },
  }),
  Checks: def({
    description: 'A row of check pills (tests, lint, types, preview). Children are Check.',
    props: z.object({}).strict(),
    children: ['Check'],
    example: {},
  }),
  Check: def({
    description: 'One check pill; detail is the tooltip (the command output).',
    props: z.object({ label: z.string().min(1).max(60), status: CheckStatus, detail: text.optional() }).strict(),
    children: 'none',
    example: { label: 'Types', status: 'pass', detail: 'tsc --noEmit, no errors, 21s' },
  }),
  FileList: def({
    description: 'Changed files with +/- counts.',
    props: z
      .object({
        files: z
          .array(z.object({ path: z.string().min(1).max(300), status: z.enum(['added', 'modified', 'deleted', 'renamed', 'conflict']), additions: z.number().int().min(0).optional(), deletions: z.number().int().min(0).optional() }).strict())
          .max(200),
      })
      .strict(),
    children: 'none',
    example: { files: [{ path: 'src/auth.ts', status: 'modified', additions: 12, deletions: 3 }] },
  }),
  Diff: def({
    description: 'A unified diff of one file. kind: add, del, ctx, ours, theirs (conflict sides).',
    props: z
      .object({
        path: z.string().min(1).max(300),
        language: z.string().max(20).optional(),
        lines: z.array(z.object({ kind: z.enum(['add', 'del', 'ctx', 'ours', 'theirs', 'hunk']), text: z.string().max(400), n: z.number().int().optional() }).strict()).max(400),
      })
      .strict(),
    children: 'none',
    example: { path: 'src/auth.ts', lines: [{ kind: 'hunk', text: '@@ -10,3 +10,4 @@' }, { kind: 'del', text: 'const key = OLD' }, { kind: 'add', text: 'const key = rotate()' }] },
  }),
  KeyValue: def({
    description: 'Label/value pairs.',
    props: z.object({ items: z.array(z.object({ key: z.string().min(1).max(60), value: z.string().max(300) }).strict()).max(40) }).strict(),
    children: 'none',
    example: { items: [{ key: 'Branch', value: 'feat/session-refresh' }] },
  }),
  Callout: def({
    description: 'A highlighted note: a warning, a failure, a decision the person must make.',
    props: z.object({ tone: Tone, title: z.string().max(120).optional(), text }).strict(),
    children: 'any',
    example: { tone: 'warning', title: '2 tests failed', text: 'session.refresh expired tokens are not rotated.' },
  }),
  Actions: def({
    description: 'A row of buttons. Children are Button.',
    props: z.object({ align: z.enum(['start', 'end']).optional() }).strict(),
    children: ['Button'],
    example: {},
  }),
  Button: def({
    description: 'A control. Clicking sends action back to you as a ui.action event. The action must be declared in /actions.',
    props: z.object({ label: z.string().min(1).max(40), action: ActionRef, variant: z.enum(['primary', 'secondary', 'danger', 'ghost']).optional(), confirm: z.string().max(200).optional(), disabled: z.boolean().optional() }).strict(),
    children: 'none',
    example: { label: 'Resolve conflicts', action: { name: 'resolve_conflicts' }, variant: 'primary' },
  }),
} satisfies Record<string, ComponentDef>;

export type ComponentType = keyof typeof CATALOG;
export const COMPONENT_TYPES = Object.keys(CATALOG) as ComponentType[];

export function findComponent(type: string): ComponentDef | undefined {
  return (CATALOG as Record<string, ComponentDef>)[type];
}

/**
 * Words models reach for that mean a catalog value. Used only by the repair pass, which
 * records each substitution as a lossless fix (the meaning is the same).
 */
export const ENUM_SYNONYMS: Record<string, string> = {
  complete: 'done', completed: 'done', success: 'done', succeeded: 'done', finished: 'done', ok: 'done',
  'in-progress': 'running', in_progress: 'running', inprogress: 'running', active: 'running', working: 'running', loading: 'running', started: 'running',
  failed: 'error', failure: 'error', failing: 'error', broken: 'error',
  warn: 'warning', caution: 'warning', conflict: 'warning',
  queued: 'pending', todo: 'pending', waiting: 'pending', idle: 'pending',
  passed: 'pass', passing: 'pass', green: 'success', red: 'danger', error_tone: 'danger', yellow: 'warning', orange: 'warning', blue: 'info', purple: 'merged', gray: 'neutral', grey: 'neutral',
  primary_btn: 'primary', outline: 'secondary', secondary_btn: 'secondary', destructive: 'danger',
  horizontal: 'row', vertical: 'column', col: 'column',
};

/** Component names models write that are not ours, mapped to ours (lossless: same thing). */
export const TYPE_ALIASES: Record<string, string> = {
  progressbar: 'Progress', progress_bar: 'Progress', meter: 'Progress',
  row: 'Stack', column: 'Stack', col: 'Stack', vstack: 'Stack', hstack: 'Stack', box: 'Stack', container: 'Stack', group: 'Stack',
  paragraph: 'Text', p: 'Text', label: 'Text', markdown: 'Text',
  title: 'Heading', header: 'Heading', h1: 'Heading', h2: 'Heading', h3: 'Heading',
  step: 'TimelineItem', steps: 'Timeline', timeline_item: 'TimelineItem',
  alert: 'Callout', notice: 'Callout', banner: 'Callout',
  tag: 'Badge', chip: 'Badge', pill: 'Badge',
  stat: 'Metric', kpi: 'Metric',
  buttons: 'Actions', buttongroup: 'Actions', button_group: 'Actions',
  check: 'Check', checks: 'Checks', checklist: 'Checks',
  files: 'FileList', filelist: 'FileList',
  codediff: 'Diff', diffview: 'Diff',
};

/** Implied props when an alias carries meaning (Row is a Stack with direction row). */
export const ALIAS_PROPS: Record<string, Record<string, unknown>> = {
  row: { direction: 'row' }, hstack: { direction: 'row' }, column: { direction: 'column' }, col: { direction: 'column' }, vstack: { direction: 'column' },
};
