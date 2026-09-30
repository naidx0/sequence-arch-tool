/**
 * THE TURN'S OWN WORK LIST — declared by the model, owned by the server, shown
 * to the person waiting.
 *
 * THE GAP THIS CLOSES. Plan mode produces PROSE (`@sequence/acp`,
 * `PLAN_MODE_INSTRUCTIONS`: "End with the plan itself"), and the ask loop runs
 * up to sixteen rounds of tools with nothing between them but an evidence
 * ledger. So a long piece of work had two halves that never met: a plan nothing
 * executed, and an execution that kept no plan. The reader watching a
 * twelve-round turn saw `step:start provider` twelve times and could not tell
 * whether anything was advancing.
 *
 * ── THE FIVE RULES, AND WHY EACH ONE IS A RULE ───────────────────────────────
 *
 * 1. THE WHOLE LIST, EVERY TIME. `update_todos` replaces; it does not patch.
 *    Deltas across sixteen rounds drift, and a drifted list is worse than no
 *    list because the reader believes it. A replace is checkable against the
 *    previous one, which is what {@link diffTodos} does.
 *
 * 2. AT MOST ONE `active`. Two things cannot both be "what is happening now",
 *    and a list that claims they can is a list nobody can read for progress.
 *    A second active is REFUSED rather than silently demoted — demoting one
 *    would pick which of the model's two claims to believe.
 *
 * 3. `blocked` CARRIES A REASON. A step that cannot proceed and does not say
 *    why is indistinguishable from a step nobody has started, and that is the
 *    difference between "waiting for you" and "forgotten".
 *
 * 4. IDS ARE THE MODEL'S AND THEY ARE STABLE. A step whose id changes is a new
 *    step, and the diff will say so. This is deliberately not a similarity
 *    match on titles: guessing that a renamed step is the same step is how a
 *    progress display starts lying.
 *
 * 5. NOTHING HERE EXECUTES ANYTHING. The list is a description of work the
 *    turn's own rounds are doing; it does not spawn, schedule, or run. Saying
 *    so matters because the list LOOKS like an executor, and a reader who
 *    believes each row is a separate worker is holding a wrong model of their
 *    own product.
 */

/** What a step can be. Closed, and ordered by how far along it is. */
export const TODO_STATUSES = ['pending', 'active', 'done', 'blocked'] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoItem {
  /** The model's own id, stable across rounds. */
  id: string;
  /** What this step is, in plain English. */
  title: string;
  status: TodoStatus;
  /** Required on `blocked`, refused everywhere else. */
  note?: string;
}

/** Enough steps for real work, few enough that the list stays readable. */
export const MAX_TODO_ITEMS = 40;
const MAX_TODO_TITLE_CHARS = 200;
const MAX_TODO_NOTE_CHARS = 300;
const MAX_TODO_ID_CHARS = 80;

export interface TodoParseOk {
  ok: true;
  items: TodoItem[];
}
export interface TodoParseError {
  ok: false;
  /** The refusal, phrased so the model can fix it on the next round. */
  reason: string;
}
export type TodoParseResult = TodoParseOk | TodoParseError;

function text(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

/**
 * Validate one `update_todos` payload.
 *
 * REFUSES rather than repairs, on every rule above. A tool that quietly fixes
 * its input teaches the model nothing and leaves the reader looking at a list
 * the model did not write — the same stance `propose_topology` takes to an
 * invented node id, and `propose_chart` to a claimed `nodeId`.
 */
export function parseTodos(raw: unknown): TodoParseResult {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: '"items" must be an array of steps' };
  }
  if (raw.length === 0) {
    return {
      ok: false,
      reason: 'an empty list is not a plan — send the steps, or do not call this tool',
    };
  }
  if (raw.length > MAX_TODO_ITEMS) {
    return { ok: false, reason: `at most ${MAX_TODO_ITEMS} steps (got ${raw.length})` };
  }
  const items: TodoItem[] = [];
  const seen = new Set<string>();
  let actives = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, reason: 'every step must be an object' };
    }
    const o = entry as Record<string, unknown>;
    const id = text(o.id, MAX_TODO_ID_CHARS);
    if (id === '') return { ok: false, reason: 'every step needs a non-empty "id"' };
    if (seen.has(id)) return { ok: false, reason: `duplicate step id "${id}"` };
    seen.add(id);
    const title = text(o.title, MAX_TODO_TITLE_CHARS);
    if (title === '') return { ok: false, reason: `step "${id}" needs a non-empty "title"` };
    const status = text(o.status, 16);
    if (!(TODO_STATUSES as readonly string[]).includes(status)) {
      return {
        ok: false,
        reason: `step "${id}" has status "${status || '(missing)'}" — use one of: ${TODO_STATUSES.join(', ')}`,
      };
    }
    const item: TodoItem = { id, title, status: status as TodoStatus };
    const note = text(o.note, MAX_TODO_NOTE_CHARS);
    if (status === 'blocked') {
      if (note === '') {
        return {
          ok: false,
          reason: `step "${id}" is blocked and must say why in "note" — a blocked step with no reason reads as a forgotten one`,
        };
      }
      item.note = note;
    } else if (note !== '') {
      /* Kept, but only where it cannot be mistaken for the blocking reason. */
      item.note = note;
    }
    if (status === 'active') actives += 1;
    items.push(item);
  }
  if (actives > 1) {
    return {
      ok: false,
      reason: `${actives} steps are "active" — exactly one step may be what is happening now`,
    };
  }
  return { ok: true, items };
}

export interface TodoDiff {
  /** Steps that reached `done` in this update. */
  completed: TodoItem[];
  /** Steps that became `blocked` in this update. */
  blocked: TodoItem[];
  /** Ids present now that were not present before. */
  added: TodoItem[];
  /** True when anything moved forward — the signal a round was productive. */
  advanced: boolean;
}

/**
 * WHAT CHANGED BETWEEN TWO ROUNDS' LISTS.
 *
 * `advanced` is the one the pipeline reads: a round in which a step reached
 * `done` is a round that got somewhere, whatever the evidence ledger thinks.
 * Without this, a long build was cut by the unproductive-round rule precisely
 * when it was working well — re-reading a file it had already read in order to
 * apply the edit it had planned is "nothing new" to the ledger and is the
 * entire job to the person waiting.
 *
 * A step going BACKWARD (done → pending) is not advancement and is deliberately
 * not counted, so a model cannot buy rounds by toggling a row.
 */
export function diffTodos(before: readonly TodoItem[], after: readonly TodoItem[]): TodoDiff {
  const prior = new Map(before.map((i) => [i.id, i]));
  const completed: TodoItem[] = [];
  const blocked: TodoItem[] = [];
  const added: TodoItem[] = [];
  for (const item of after) {
    const was = prior.get(item.id);
    if (was === undefined) {
      added.push(item);
      if (item.status === 'done') completed.push(item);
      if (item.status === 'blocked') blocked.push(item);
      continue;
    }
    if (item.status === 'done' && was.status !== 'done') completed.push(item);
    if (item.status === 'blocked' && was.status !== 'blocked') blocked.push(item);
  }
  return {
    completed,
    blocked,
    added,
    advanced: completed.length > 0,
  };
}

/** Steps still to do — neither finished nor blocked. */
export function remainingTodos(items: readonly TodoItem[]): TodoItem[] {
  return items.filter((i) => i.status === 'pending' || i.status === 'active');
}

/** True when every step is finished or blocked: there is nothing left to run. */
export function todosSettled(items: readonly TodoItem[]): boolean {
  return items.length > 0 && remainingTodos(items).length === 0;
}

const STATUS_MARK: Record<TodoStatus, string> = {
  pending: '[ ]',
  active: '[>]',
  done: '[x]',
  blocked: '[!]',
};

/**
 * The list as the model sees it at the top of the next round.
 *
 * CARRIED FORWARD EVERY ROUND, because the alternative was measured everywhere
 * else in this pipeline and fails the same way: a model that declared a plan in
 * round two and is shown only an evidence ledger in round seven writes a
 * different plan. The list is small — forty rows at one line each — so carrying
 * it whole costs almost nothing and removes the failure entirely.
 */
export function renderTodoSection(items: readonly TodoItem[]): string[] {
  if (items.length === 0) return [];
  const L: string[] = ['--- YOUR WORK LIST (as you last set it) ---'];
  for (const i of items) {
    L.push(`${STATUS_MARK[i.status]} ${i.id}: ${i.title}${i.note ? ` — ${i.note}` : ''}`);
  }
  const left = remainingTodos(items);
  if (left.length === 0) {
    L.push(
      'Every step is finished or blocked. Do not call `update_todos` again — write the answer.',
    );
  } else {
    L.push(
      `${left.length} step(s) left. Keep working the list: do the next one, then call ` +
        '`update_todos` with the WHOLE list and that step marked done. Never re-send a list ' +
        'that has lost steps you already finished.',
    );
  }
  return L;
}

/** One line of trail for the tool result — what the reader sees in the work row. */
export function todoEvidence(diff: TodoDiff, items: readonly TodoItem[]): string {
  const left = remainingTodos(items).length;
  const parts: string[] = [];
  if (diff.completed.length > 0) parts.push(`${diff.completed.length} done`);
  if (diff.blocked.length > 0) parts.push(`${diff.blocked.length} blocked`);
  parts.push(left === 0 ? 'list complete' : `${left} left`);
  return `${items.length} step(s) — ${parts.join(', ')}`;
}
