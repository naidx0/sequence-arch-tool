import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GetProgramRunsResponse, ProgramRunSummary } from '@sequence/api-types';

import { ActivityPane } from './ActivityPane';
import { ConnectedActivity } from './ConnectedActivity';
import { ACTIVITY } from './anchors';
import { RUN_STATES } from './activityModel';
import type { ActivityClient } from './activityClient';
import { detail, oneOfEach, summary } from './fixtures';

/* ══════════════════════════════════════════════════════════════════════════
   P9 — THE ACTIVITY VIEW'S LOCKS
   packages/web2/src/activity/ActivityPane.test.tsx

   NOTHING HERE ASSERTS A CALLBACK FIRED WHERE THE POINT WAS THAT SOMETHING
   OPENED. CANON §6: "This project has twice shipped a test asserting that a
   dispatch landed while the button opened nothing." So the open-a-run lock
   below drives `ConnectedActivity` with a recording client, clicks a REAL row
   with `fireEvent`, and reads the run's steps out of the DOM — the spy is used
   only to prove WHICH run id went to the engine, never to stand in for the
   panel appearing.
   ══════════════════════════════════════════════════════════════════════════ */

afterEach(cleanup);

const NOW = 1_700_000_060_000; // one minute after every fixture's startedAt

function pane(over: Partial<Parameters<typeof ActivityPane>[0]> = {}) {
  return render(
    <ActivityPane
      runs={null}
      now={NOW}
      filter="all"
      onFilter={() => undefined}
      onOpen={() => undefined}
      onCloseRun={() => undefined}
      {...over}
    />,
  );
}

const rows = () => screen.queryAllByTestId(ACTIVITY.row);

describe('the list renders the runs the engine listed, and no others', () => {
  it('draws one row per run, carrying that run’s own id and status', () => {
    const runs = oneOfEach();
    pane({ runs });

    expect(rows()).toHaveLength(runs.length);
    for (const run of runs) {
      const row = rows().find((el) => el.dataset.runId === run.runId);
      expect(row, `no row for ${run.runId}`).toBeTruthy();
      expect(row?.dataset.status).toBe(run.status);
    }
  });

  it('writes every state out as a word, so no state is a colour alone', () => {
    // Sheet 12.5. A test that read the tone attribute alone would pass on a
    // surface that drew six identically-worded rows in six colours.
    const runs = oneOfEach();
    pane({ runs });

    for (const run of runs) {
      const row = rows().find((el) => el.dataset.runId === run.runId);
      const state = within(row as HTMLElement).getByTestId(ACTIVITY.rowState);
      expect(state.textContent).toContain(RUN_STATES[run.status].word);
    }
  });

  it('says what each run is running, from the engine’s own program name', () => {
    pane({ runs: [summary({ programName: 'Nightly sweep' })] });
    expect(screen.getByTestId(ACTIVITY.rowProgram).textContent).toBe('Nightly sweep');
  });

  it('draws an em dash, never the run id, when the engine sent no program name', () => {
    /*
     * `programName` is documented as "the program's `name`, or its id when it
     * declares no name" — the engine has already fallen back. Putting the RUN
     * id in that slot would read as a program called `run-…`, which is the F4
     * shape: a value rendered in the place reserved for a different claim.
     */
    pane({ runs: [summary({ runId: 'run-zz9-0000ffff', programName: '' })] });
    const cell = screen.getByTestId(ACTIVITY.rowProgram);
    expect(cell.textContent).toBe('—');
    expect(cell.textContent).not.toContain('run-zz9');
  });

  it('prints the node fraction the engine supplied, and none when there is no denominator', () => {
    pane({ runs: [summary({ nodesTotal: 7, nodesDone: 3 })] });
    expect(screen.getByTestId(ACTIVITY.rowProgress).textContent).toContain('3/7');

    cleanup();
    // A program that declares no node has nothing to be a fraction of. "0/0" is
    // F1 in miniature — a count printed where there is nothing to count.
    pane({ runs: [summary({ nodesTotal: 0, nodesDone: 0 })] });
    expect(screen.queryByTestId(ACTIVITY.rowProgress)).toBeNull();
  });

  it('shows how much a run changed, and shows NOTHING when it was not measured', () => {
    pane({ runs: [summary({ changed: { files: 3, added: 40, removed: 12, uncountedFiles: 0 } })] });
    expect(screen.getByTestId(ACTIVITY.rowChanged).textContent).toBe('3 files +40 -12');

    cleanup();
    /* A run still going has not been measured. "no files changed" is a
       MEASUREMENT, and printing it here would be a number nobody took. */
    pane({ runs: [summary()] });
    expect(screen.queryByTestId(ACTIVITY.rowChanged)).toBeNull();
  });

  it('carries the shared-tree caveat onto the row itself', () => {
    pane({ runs: [summary({ changed: { files: 5, added: 10, removed: 0, uncountedFiles: 0, overlapping: true } })] });
    expect(screen.getByTestId(ACTIVITY.rowChanged).textContent).toMatch(/shared with another run/);
  });

  it('prints the engine’s own error sentence and composes none of its own', () => {
    const message = 'the executor refused: no model configured';
    pane({ runs: [summary({ status: 'failed', error: message })] });
    expect(screen.getByTestId(ACTIVITY.rowError).textContent).toBe(message);

    cleanup();
    // A clean finish carries no reason, and none is invented for it.
    pane({ runs: [summary({ status: 'completed' })] });
    expect(screen.queryByTestId(ACTIVITY.rowError)).toBeNull();
  });

  it('says WHY a run that ran to its end was rejected, in the words of whatever rejected it', () => {
    /*
     * ══ THE ROW THAT SAID "DONE" ══════════════════════════════════════════
     *
     * A measured `review-loop` run came back `status: 'completed'` with
     * `nodesError: 0`, while its own final state held `checkerOk: 'no'` and
     * `violations: 'ungrounded node id: …'`. The row read Done, in the tone a
     * clean run gets. The engine now reports the outcome as its own status and
     * carries the reasons on the summary; this is the surface honouring both.
     */
    const reasons = ['ungrounded node id: svc:invented', 'loop exited at its maxIterations cap (3)'];
    pane({ runs: [summary({ status: 'completed-with-violations', violations: reasons })] });

    const row = screen.getByTestId(ACTIVITY.row);
    expect(row.dataset.status).toBe('completed-with-violations');
    // NOT the word or the tone a clean run gets.
    expect(row.dataset.tone).toBe('failed');
    expect(within(row).getByTestId(ACTIVITY.rowState).textContent).not.toBe(RUN_STATES.completed.word);

    // And every reason is on screen, verbatim.
    const shown = screen.getByTestId(ACTIVITY.rowViolations).textContent ?? '';
    for (const reason of reasons) expect(shown).toContain(reason);
  });

  it('invents no rejection line for a run the engine sent none for', () => {
    /* ABSENT IS NOT "IT PASSED". A program with no checker and no capped loop
       can never populate this, and drawing anything here would be a verdict
       nobody reached. */
    pane({ runs: [summary({ status: 'completed' })] });
    expect(screen.queryByTestId(ACTIVITY.rowViolations)).toBeNull();
  });

  it('stops a finished run’s elapsed figure at its own finishedAt', () => {
    pane({
      runs: [summary({ status: 'completed', startedAt: 1_000, finishedAt: 61_000 })],
      now: 999_999_999,
    });
    // 60s, not "however long ago that was" — the clock does not keep running
    // for a run that stopped.
    expect(screen.getByTestId(ACTIVITY.rowMeta).textContent).toContain('1m');
  });
});

describe('the three absences are three, and none of them is a count', () => {
  it('states that the engine has not answered, and draws no figure anywhere', () => {
    /*
     * THE STATE THIS SURFACE IS ACTUALLY IN BEFORE THE FIRST RESPONSE. The
     * whole class of defect this package is held to is a surface asserting
     * something the engine never supplied, and the tempting thing here is a
     * bucket bar reading All 0 · Waiting 0 · Blocked 0 — six honest-looking
     * zeros measured over a list nobody has read.
     */
    const { container } = pane({ runs: null });

    expect(screen.getByTestId(ACTIVITY.unanswered)).toBeTruthy();
    expect(screen.queryByTestId(ACTIVITY.bucketBar)).toBeNull();
    expect(screen.queryByTestId(ACTIVITY.list)).toBeNull();
    expect(screen.queryByTestId(ACTIVITY.empty)).toBeNull();
    expect(rows()).toHaveLength(0);

    const text = container.textContent ?? '';
    expect(
      text.match(/\d/g) ?? [],
      `no numeral may appear with no run list behind it. rendered: ${JSON.stringify(text)}`,
    ).toEqual([]);
    // And no state word either: a status is a claim about a run, and there is
    // no run here to make it about.
    for (const state of Object.values(RUN_STATES)) {
      expect(text, `"${state.word}" appears with no run behind it`).not.toContain(state.word);
    }
  });

  it('tells an unread list apart from a list the engine says is empty', () => {
    pane({ runs: [] });
    expect(screen.getByTestId(ACTIVITY.empty)).toBeTruthy();
    expect(screen.queryByTestId(ACTIVITY.unanswered)).toBeNull();
    // Zero IS the honest value here: the engine answered, and it listed nothing.
    const bar = screen.getByTestId(ACTIVITY.bucketBar);
    const all = within(bar)
      .getAllByTestId(ACTIVITY.bucketBtn)
      .find((b) => b.dataset.bucket === 'all');
    expect(all?.dataset.count).toBe('0');
  });

  it('prints the engine’s refusal in the engine’s own words', () => {
    pane({ runs: null, failure: 'no repository attached' });
    expect(screen.getByTestId(ACTIVITY.failure).textContent).toBe('no repository attached');
    // A refusal is not an absence and must not also claim one.
    expect(screen.queryByTestId(ACTIVITY.unanswered)).toBeNull();
  });

  it('blames the filter, not the engine, when a real list matches nothing', () => {
    pane({ runs: [summary({ status: 'running' })], filter: 'blocked' });
    expect(screen.getByTestId(ACTIVITY.noMatch)).toBeTruthy();
    expect(screen.queryByTestId(ACTIVITY.empty)).toBeNull();
    expect(rows()).toHaveLength(0);
  });
});

describe('the filter answers "which of my runs needs me"', () => {
  it('counts each bucket over the list the engine sent', () => {
    pane({ runs: oneOfEach() });
    const counts: Record<string, string | undefined> = {};
    for (const button of screen.getAllByTestId(ACTIVITY.bucketBtn)) {
      counts[button.dataset.bucket ?? ''] = button.dataset.count;
    }
    // running · paused · interrupted · completed · completed-with-violations
    // · failed · stopped
    expect(counts).toEqual({
      all: '7',
      running: '1',
      waiting: '1',
      blocked: '1',
      finished: '4',
    });
  });

  it('says in words how many runs are waiting on the reader', () => {
    const { container } = pane({ runs: oneOfEach() });
    // paused + interrupted. Not the running one: a run that is advancing needs
    // nobody, and counting it would make the headline permanently non-zero.
    expect(container.textContent).toContain('2 waiting on you');

    cleanup();
    const idle = pane({ runs: [summary({ status: 'completed' })] });
    expect(idle.container.textContent).toContain('Nothing is waiting on you');
  });

  it('shows only the runs in the chosen bucket, on a real click', () => {
    const seen: string[] = [];
    const runs = oneOfEach();
    const { rerender } = render(
      <ActivityPane
        runs={runs}
        now={NOW}
        filter="all"
        onFilter={(f) => seen.push(f)}
        onOpen={() => undefined}
        onCloseRun={() => undefined}
      />,
    );

    const waiting = screen
      .getAllByTestId(ACTIVITY.bucketBtn)
      .find((b) => b.dataset.bucket === 'waiting') as HTMLElement;
    fireEvent.click(waiting);
    expect(seen).toEqual(['waiting']);

    // AND THE LIST ACTUALLY NARROWS. Asserting the callback alone would be the
    // "a dispatch landed" test CANON §6 names.
    rerender(
      <ActivityPane
        runs={runs}
        now={NOW}
        filter="waiting"
        onFilter={() => undefined}
        onOpen={() => undefined}
        onCloseRun={() => undefined}
      />,
    );
    expect(rows()).toHaveLength(1);
    expect(rows()[0].dataset.status).toBe('paused');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   CLICKING A RUN OPENS IT — the wired path, over a recording client.
   ══════════════════════════════════════════════════════════════════════════ */

function client(over: Partial<ActivityClient> = {}): ActivityClient & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    runs: async () => {
      asked.push('/api/program/runs');
      return {
        outcome: 'ok',
        status: 200,
        body: { runs: oneOfEach() } satisfies GetProgramRunsResponse,
      };
    },
    run: async (runId: string) => {
      asked.push(`/api/program/runs/${runId}`);
      return { outcome: 'ok', status: 200, body: detail() };
    },
    /* Writes default to unreachable so Partial overrides stay explicit.
       WireResult has no "refused" — that was a TS build break on tip a383fa75. */
    start: async () => ({ outcome: 'unreachable' as const, message: 'stub' }),
    pause: async () => ({ outcome: 'ok' as const, status: 200, body: {} as unknown }),
    resume: async () => ({ outcome: 'ok' as const, status: 200, body: {} as unknown }),
    cancel: async () => ({
      outcome: 'ok' as const,
      status: 200,
      body: { ok: true as const, runId: 'stub', cancelled: false, status: 'stopped' as const },
    }),
    /* P4 preflight — author form probes these; omitting them threw unhandled
       TypeError in CI (1710 green assertions, exit 1). */
    acpAvailable: async () => ({
      outcome: 'ok' as const,
      status: 200,
      body: { available: true },
    }),
    acpAgents: async () => ({
      outcome: 'ok' as const,
      status: 200,
      body: { agents: [{ id: 'local', command: 'echo' }] },
    }),
    ...over,
  };
}

describe('clicking a run opens it', () => {
  it('asks the engine for that run and draws its real steps', async () => {
    const c = client();
    render(<ConnectedActivity client={c} pollMs={0} now={() => NOW} />);

    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const row = rows().find((el) => el.dataset.status === 'running') as HTMLElement;
    const runId = row.dataset.runId as string;

    fireEvent.click(row);

    // The panel is on screen, and it is THIS run's.
    const panel = await screen.findByTestId(ACTIVITY.detail);
    expect(panel.dataset.runId).toBe(runId);
    expect(c.asked).toContain(`/api/program/runs/${runId}`);

    // The steps are the program's own, as the record stored them.
    await waitFor(() =>
      expect(screen.getAllByTestId(ACTIVITY.detailNode).map((n) => n.dataset.nodeId)).toEqual([
        'n1',
        'n2',
        'n3',
      ]),
    );
  });

  it('reads each step’s state off the durable log, and states the absence for a step the log never mentions', async () => {
    const c = client();
    render(<ConnectedActivity client={c} pollMs={0} now={() => NOW} />);
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    fireEvent.click(rows()[0]);

    await screen.findByTestId(ACTIVITY.detail);
    await waitFor(() => expect(screen.getAllByTestId(ACTIVITY.detailNode)).toHaveLength(3));
    const nodes = screen.getAllByTestId(ACTIVITY.detailNode);
    const byId = Object.fromEntries(nodes.map((n) => [n.dataset.nodeId, n]));

    // n1 finished; n2's LAST event is `running`, not the earlier `queued`.
    expect(byId.n1.dataset.nodeStatus).toBe('done');
    expect(byId.n2.dataset.nodeStatus).toBe('running');

    /*
     * n3 IS THE POINT OF THIS CASE. The log says nothing whatsoever about it.
     * "Queued" would be this surface speaking on the scheduler's behalf about a
     * step the scheduler has not mentioned — the F1 defect exactly.
     */
    expect(byId.n3.dataset.nodeStatus).toBe('none');
    expect(byId.n3.textContent).toContain('—');
    expect(byId.n3.textContent).not.toContain('Queued');
  });

  it('renders the committed log newest first, carrying each row’s own seq', async () => {
    const c = client();
    render(<ConnectedActivity client={c} pollMs={0} now={() => NOW} />);
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    fireEvent.click(rows()[0]);

    await waitFor(() => expect(screen.getAllByTestId(ACTIVITY.detailEvent).length).toBe(4));
    const seqs = screen.getAllByTestId(ACTIVITY.detailEvent).map((e) => e.dataset.seq);
    expect(seqs).toEqual(['4', '3', '2', '1']);
  });

  it('states the absence rather than an empty step list when the engine refuses the run', async () => {
    const c = client({
      run: async () => ({ outcome: 'error', status: 404, body: { error: 'run not found' } }),
    });
    render(<ConnectedActivity client={c} pollMs={0} now={() => NOW} />);
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    fireEvent.click(rows()[0]);

    expect((await screen.findByTestId(ACTIVITY.detailFailure)).textContent).toBe('run not found');
    expect(screen.queryAllByTestId(ACTIVITY.detailNode)).toHaveLength(0);
  });

  it('closes the run again when the same row is clicked twice', async () => {
    const c = client();
    render(<ConnectedActivity client={c} pollMs={0} now={() => NOW} />);
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));

    fireEvent.click(rows()[0]);
    await screen.findByTestId(ACTIVITY.detail);
    expect(rows()[0].getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(rows()[0]);
    await waitFor(() => expect(screen.queryByTestId(ACTIVITY.detail)).toBeNull());
    expect(rows()[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('says a run’s log is empty rather than drawing an empty list, and prints its loud notes', () => {
    /*
     * A run REGISTERED but not yet committing — `POST /api/program/run` answers
     * 202 "as soon as the run is REGISTERED, before any node executes", so a
     * log with zero rows is a real state a reader can reach. An empty `<ol>` is
     * a surface saying nothing where the truth is "nothing has happened yet".
     *
     * The note beside it is the scheduler's ONE loud run-level signal: a loop
     * that exited by hitting its cap while its predicate was still true. The
     * plan promised loops exit "loudly", and a surface that swallowed the note
     * would be where that promise quietly stopped being kept.
     */
    const base = detail();
    pane({
      runs: [summary()],
      openId: base.run.runId,
      open: {
        run: { ...base.run, notes: [{ nodeId: 'n2', kind: 'loop-cap-reached', detail: 'stopped at 20' }] },
        events: [],
      },
    });

    expect(screen.getByTestId(ACTIVITY.detailEventsEmpty)).toBeTruthy();
    expect(screen.queryAllByTestId(ACTIVITY.detailEvent)).toHaveLength(0);

    const note = screen.getByTestId(ACTIVITY.detailNote);
    expect(note.textContent).toContain('loop-cap-reached');
    expect(note.textContent).toContain('stopped at 20');

    /* AND WITH NO LOG, NO STEP CLAIMS A STATE. Every node falls to the absence,
       because the fold has nothing to fold. */
    for (const node of screen.getAllByTestId(ACTIVITY.detailNode)) {
      expect(node.dataset.nodeStatus).toBe('none');
    }
  });

  it('states that a run is being read rather than showing it as empty', () => {
    pane({ runs: [summary()], openId: 'run-mn0p1q-0123abcd', open: null, openLoading: true });
    expect(screen.getByTestId(ACTIVITY.detailLoading).textContent).toContain('Reading this run');
    expect(screen.queryAllByTestId(ACTIVITY.detailNode)).toHaveLength(0);
  });

  it('closes the run it opened, on a real click', async () => {
    const c = client();
    render(<ConnectedActivity client={c} pollMs={0} now={() => NOW} />);
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    fireEvent.click(rows()[0]);
    await screen.findByTestId(ACTIVITY.detail);

    fireEvent.click(screen.getByTestId(ACTIVITY.detailClose));
    await waitFor(() => expect(screen.queryByTestId(ACTIVITY.detail)).toBeNull());
  });
});

describe('the wiring asks the engine, and says so when it cannot', () => {
  it('reads the run list from the route the engine actually serves', async () => {
    const c = client();
    render(<ConnectedActivity client={c} pollMs={0} now={() => NOW} />);
    await waitFor(() => expect(c.asked).toContain('/api/program/runs'));
    await waitFor(() => expect(rows()).toHaveLength(7));
  });

  it('never seeds an empty list, so a slow engine is not an idle repository', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const c = client({
      runs: async () => {
        await gate;
        return { outcome: 'ok', status: 200, body: { runs: [] as ProgramRunSummary[] } };
      },
    });
    render(<ConnectedActivity client={c} pollMs={0} now={() => NOW} />);

    // Before the answer: the unanswered line, not "no runs".
    expect(screen.getByTestId(ACTIVITY.unanswered)).toBeTruthy();
    expect(screen.queryByTestId(ACTIVITY.empty)).toBeNull();

    release();
    // After it: the measured empty, not the absence.
    await waitFor(() => expect(screen.getByTestId(ACTIVITY.empty)).toBeTruthy());
    expect(screen.queryByTestId(ACTIVITY.unanswered)).toBeNull();
  });

  it('keeps the rows it has when a later request fails, and says what failed', async () => {
    let calls = 0;
    const c = client({
      runs: async () => {
        calls += 1;
        if (calls === 1) {
          return { outcome: 'ok', status: 200, body: { runs: oneOfEach() } };
        }
        return { outcome: 'unreachable', message: 'socket hang up' };
      },
    });
    render(<ConnectedActivity client={c} pollMs={0} now={() => NOW} />);
    await waitFor(() => expect(rows()).toHaveLength(7));

    fireEvent.click(screen.getByTestId(ACTIVITY.refresh));

    /* A DROPPED REQUEST HAS NOT LEARNED THAT THE RUNS ARE GONE. Blanking the
       list here would turn one failed poll into "you have no runs", which is
       the same fabrication as inventing rows, pointed the other way. */
    await waitFor(() => expect(screen.getByTestId(ACTIVITY.failure)).toBeTruthy());
    expect(screen.getByTestId(ACTIVITY.failure).textContent).toContain('socket hang up');
    expect(rows()).toHaveLength(7);
  });

  it('polls only while something is still moving', async () => {
    vi.useFakeTimers();
    try {
      const terminal = oneOfEach().filter((r) => r.status !== 'running');
      const c = client({
        runs: async () => ({ outcome: 'ok', status: 200, body: { runs: terminal } }),
      });
      render(<ConnectedActivity client={c} pollMs={50} now={() => NOW} />);
      await vi.advanceTimersByTimeAsync(0);
      const afterFirst = c.asked.length;
      await vi.advanceTimersByTimeAsync(500);
      /* A list with nothing running cannot change without something starting a
         run, and something starting a run goes through this browser. Ten ticks
         of identical bytes is a request per tick that can only ever say the
         same thing. */
      expect(c.asked.length).toBe(afterFirst);
    } finally {
      vi.useRealTimers();
    }
  });

  it('polls while a run is still running', async () => {
    vi.useFakeTimers();
    try {
      const c = client();
      render(<ConnectedActivity client={c} pollMs={50} now={() => NOW} />);
      await vi.advanceTimersByTimeAsync(0);
      const afterFirst = c.asked.length;
      await vi.advanceTimersByTimeAsync(200);
      expect(c.asked.length).toBeGreaterThan(afterFirst);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   P4 — CURATED BUILT-INS. Start posts the catalogue Program, not a freeform
   prompt that happens to share a title.
   ══════════════════════════════════════════════════════════════════════════ */

describe('P4 curated built-in workflows', () => {
  it('lists every catalogue entry in the author form', () => {
    const onStart = vi.fn();
    pane({ runs: [], authoring: true, onStart, onAuthorCancel: () => undefined });

    const builtins = screen.getAllByTestId(ACTIVITY.authorBuiltin);
    expect(builtins.map((el) => el.dataset.builtinId)).toEqual([
      'pr-triage',
      'review-loop',
      'council-against-risks',
      'route-by-blast-radius',
      'dogfood-loop',
      'build-architecture',
      'build-architecture-full',
    ]);
    expect(screen.getByTestId(ACTIVITY.authorBuiltins)).toBeTruthy();
  });

  it('opening the author form does not throw when acpAvailable is missing (CI Build lock)', async () => {
    /*
     * Tip abb9df82: 1710 tests green, suite exit 1 — ConnectedActivity called
     * client.acpAvailable on author open while ActivityPane stubs omitted it.
     * Vitest treated the TypeError as an unhandled rejection after the file.
     */
    const c = client({
      acpAvailable: undefined as unknown as ActivityClient['acpAvailable'],
    });
    render(<ConnectedActivity client={c} pollMs={0} now={() => NOW} />);
    await waitFor(() => expect(screen.getByTestId(ACTIVITY.newRun)).toBeTruthy());
    fireEvent.click(screen.getByTestId(ACTIVITY.newRun));
    expect(screen.getByTestId(ACTIVITY.author)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId(ACTIVITY.authorAcpNote).textContent).toMatch(
        /ACP readiness could not be checked/i,
      ),
    );
  });

  it('Start on a built-in posts that catalogue id — not programFrom of the blurb', async () => {
    const started: { id: string; name?: string; nodes: { kind: string }[] }[] = [];
    const c = client({
      start: async (program) => {
        started.push(program as (typeof started)[number]);
        return {
          outcome: 'ok',
          status: 202,
          body: { runId: 'run-builtin-1', status: 'running', startedAt: NOW, lastEventSeq: 0 },
        };
      },
    });
    render(<ConnectedActivity client={c} pollMs={0} now={() => NOW} />);
    await waitFor(() => expect(screen.getByTestId(ACTIVITY.newRun)).toBeTruthy());
    fireEvent.click(screen.getByTestId(ACTIVITY.newRun));

    const review = screen
      .getAllByTestId(ACTIVITY.authorBuiltin)
      .find((el) => el.dataset.builtinId === 'review-loop') as HTMLElement;
    fireEvent.click(review);
    expect(review.dataset.selected).toBe('yes');
    /* Freeform fields stand down while a built-in is selected. */
    expect(screen.queryByTestId(ACTIVITY.authorName)).toBeNull();
    expect(screen.queryByTestId(ACTIVITY.authorInstruction)).toBeNull();

    fireEvent.click(screen.getByTestId(ACTIVITY.authorStart));

    await waitFor(() => expect(started.length).toBe(1));
    expect(started[0].id).toBe('review-loop');
    expect(started[0].name).toMatch(/Review loop/i);
    /* Catalogue graph is multi-node; programFrom is start→agent→end (3). */
    expect(started[0].nodes.length).toBeGreaterThan(3);
  });
});

describe('territories — parallel worktrees, not invented conflicts', () => {
  it('renders main and parallel rows from territoryView props', () => {
    pane({
      runs: [],
      territories: {
        territories: [
          {
            path: '/repos/shop',
            name: 'shop',
            branch: 'main',
            head: 'abcdef1',
            isMain: true,
            note: null,
          },
          {
            path: '/repos/shop-agent-a',
            name: 'shop-agent-a',
            branch: 'agent-a',
            head: '1234567',
            isMain: false,
            note: null,
          },
        ],
        parallel: 1,
        sharedBranches: [],
        summary: '1 working tree beside the main checkout.',
      },
    });
    expect(screen.getByTestId(ACTIVITY.territories)).toBeTruthy();
    expect(screen.getByTestId(ACTIVITY.territoriesSummary).textContent).toMatch(/1 working tree/i);
    const rows = screen.getAllByTestId(ACTIVITY.territoryRow);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.dataset.main).toBe('yes');
    expect(rows[1]!.dataset.main).toBe('no');
    expect(rows[1]!.textContent).toMatch(/shop-agent-a/);
  });

  it('says only the main checkout when there is no parallel work', () => {
    pane({
      runs: [],
      territories: {
        territories: [
          {
            path: '/repos/shop',
            name: 'shop',
            branch: 'main',
            head: 'abcdef1',
            isMain: true,
            note: null,
          },
        ],
        parallel: 0,
        sharedBranches: [],
        summary: 'No parallel work: only the main checkout.',
      },
    });
    expect(screen.getByTestId(ACTIVITY.territoriesSummary).textContent).toMatch(
      /only the main checkout/i,
    );
    expect(screen.queryByTestId(ACTIVITY.territoriesEmpty)).toBeNull();
  });

  it('draws nothing when territories were never answered', () => {
    pane({ runs: [], territories: null });
    expect(screen.queryByTestId(ACTIVITY.territories)).toBeNull();
  });
});
