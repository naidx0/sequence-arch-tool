import type { TodoItem } from '../state/types';

/* ══════════════════════════════════════════════════════════════════════════
   THE TURN'S WORK LIST — what it set out to do, and how far it has got.
   packages/web2/src/chat/TodoList.tsx

   THE GAP IT FILLS. A turn may run sixteen rounds. Until this existed the
   reader saw `step:start provider` sixteen times — the pipeline's own phases,
   identical whatever the job was — and could not tell a turn that was working
   from a turn that was circling. The server half is `todoList.ts`; this is the
   only place it is seen.

   HUE BUDGET: 2, and both already mean exactly this.
     --accent  the ACTIVE step. Decision 12 clause 6: purple marks what was
               chosen, and the active step is what this turn is doing now.
     --wont    a BLOCKED step, and only a blocked one. Blocked is a claim about
               the world — this cannot proceed and here is why — which is the
               test Graphite law 1 sets for spending a hue.
   `pending` and `done` get NO hue. They are positions in a list, not claims,
   and a green tick beside every finished row would spend --fits on the fact
   that time passes. They are separated by INK WEIGHT and by the mark, which is
   the same answer sheet 11 gives the rail's two rungs.

   NOT A WORK ROW, and the two must not be made to look alike. A work row is
   something that HAPPENED — past tense, appended, never revised. A todo is
   something INTENDED, and the whole list is replaced on every update. A reader
   who cannot tell those apart cannot read a long turn at all.
   ══════════════════════════════════════════════════════════════════════════ */

export interface TodoListProps {
  items: readonly TodoItem[];
  /** True while the turn is still running — the only thing that animates. */
  streaming?: boolean;
}

/**
 * The mark, per status. Text, not an icon font: these line up in a monospace
 * column and a reader scanning for "what is left" is scanning that column.
 */
const MARK: Record<TodoItem['status'], string> = {
  pending: '○',
  active: '◆',
  done: '✓',
  blocked: '!',
};

/**
 * The header counts DONE OUT OF TOTAL, and blocked steps are counted into
 * neither half.
 *
 * A blocked step is not done and is not waiting its turn — calling it either
 * would make the fraction a number the reader can disprove by looking at the
 * rows underneath it, which is exactly the defect sheet 11.5 names about the
 * rail's match count ("a count a reader can disprove by looking is worse than
 * no count at all"). So it is named separately, in words, or not at all.
 */
function headline(items: readonly TodoItem[]): string {
  const done = items.filter((i) => i.status === 'done').length;
  const blocked = items.filter((i) => i.status === 'blocked').length;
  const base = `${done} of ${items.length} done`;
  return blocked === 0 ? base : `${base} · ${blocked} blocked`;
}

export function TodoList({ items, streaming = false }: TodoListProps) {
  if (items.length === 0) return null;
  const done = items.filter((i) => i.status === 'done').length;
  return (
    <section
      className="todo-list"
      data-testid="todo-list"
      data-streaming={streaming ? 'true' : 'false'}
      aria-label="Work list"
    >
      <div className="todo-list-head">
        <span className="todo-list-title">Work list</span>
        <span className="todo-list-count">{headline(items)}</span>
      </div>
      <div className="todo-list-track" data-testid="todo-list-track" aria-hidden="true">
        <div
          className="todo-list-fill"
          data-streaming={streaming ? 'true' : 'false'}
          style={{ transform: `scaleX(${done / items.length})` }}
        />
      </div>
      <ol className="todo-list-rows">
        {items.map((item) => (
          <li key={item.id} className="todo-row" data-status={item.status}>
            <span className="todo-mark" aria-hidden="true">
              {MARK[item.status]}
            </span>
            <span className="todo-title">{item.title}</span>
            {/* The reason rides the row it explains. A blocked step whose
                reason lives somewhere else is a blocked step nobody reads. */}
            {item.note ? <span className="todo-note">{item.note}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
