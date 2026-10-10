import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { validateProgram, type Program } from '@sequence/schema';

import type { ProgramRunStatus } from '@sequence/api-types';

import { ACTIVITY } from './anchors';
import { RUN_STEP_BUDGETS, RUN_TIME_BUDGETS } from './activityModel';
import { detail, summary } from './fixtures';
import { ConnectedActivity } from './ConnectedActivity';

afterEach(cleanup);

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE SEAM — a gesture reaches the engine, or the feature does not exist
 *
 * `runAuthor.test.ts` proves the program is valid. `ActivityPane.test.tsx`
 * proves the form draws. NEITHER PROVES A RUN CAN BE STARTED, and this
 * repository's whole documented failure mode lives in that gap: "a test that
 * asserts the props is not a test of the mount."
 *
 * So this mounts `ConnectedActivity` THE WAY THE APP MOUNTS IT — no props
 * beyond a clock — clicks the real controls, types into the real fields, and
 * asserts a real `POST /api/program/run` arrives carrying a program the real
 * validator accepts. It fails if the button, the form, the handler, the client
 * method or the route string is disconnected at any joint.
 * ══════════════════════════════════════════════════════════════════════════
 */

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** A fetch that records, and answers whatever the case under test needs. */
function stubFetch(
  answer: (url: string, method: string) => { status: number; body: unknown },
  opts: { acp?: 'ready' | 'unavailable' | 'no-agents' } = {},
) {
  const acp = opts.acp ?? 'ready';
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = String(url);
      calls.push({
        url: path,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      /* Author preflight is answered here so older POST-focused cases stay
         focused — override via opts.acp when locking the note itself. */
      let status: number;
      let body: unknown;
      if (method === 'GET' && path === '/api/acp/available') {
        status = 200;
        body =
          acp === 'unavailable'
            ? { available: false, reason: 'ACP is not available' }
            : { available: true };
      } else if (method === 'GET' && path === '/api/acp/agents') {
        status = 200;
        body =
          acp === 'ready'
            ? { agents: [{ id: 'local', command: 'echo' }] }
            : { agents: [] };
      } else {
        ({ status, body } = answer(path, method));
      }
      /* `text`, not `json`: the client decides JSON by PARSING rather than by
         trusting a content-type header, so a stub that only answers `json()`
         is answering a method the product never calls. The first cut of this
         helper did exactly that and every list came back empty. */
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
  return calls;
}

const NO_RUNS = { runs: [] };
const ACCEPTED = {
  runId: 'run-abc123-0f9e8d7c',
  status: 'running',
  startedAt: 1_000,
  lastEventSeq: 0,
};

/** Reach the form the way a reader does: the button in the pane's header. */
async function openTheForm() {
  render(<ConnectedActivity now={() => 1_000} pollMs={0} />);
  const open = await screen.findByTestId(ACTIVITY.newRun);
  fireEvent.click(open);
  return screen.getByTestId(ACTIVITY.author);
}

function fill(name: string, instruction: string) {
  fireEvent.change(screen.getByTestId(ACTIVITY.authorName), { target: { value: name } });
  fireEvent.change(screen.getByTestId(ACTIVITY.authorInstruction), {
    target: { value: instruction },
  });
}

describe('starting a run, from the surface the app mounts', () => {
  it('THE POST ARRIVES, and it carries a program the real validator accepts', async () => {
    const calls = stubFetch((_url, method) =>
      method === 'POST' ? { status: 202, body: ACCEPTED } : { status: 200, body: NO_RUNS },
    );

    await openTheForm();
    fill('harden login', 'add rate limiting to POST /login');
    fireEvent.click(screen.getByTestId(ACTIVITY.authorStart));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true);
    });

    const post = calls.find((c) => c.method === 'POST')!;
    /* The route, exactly. `/api/program/run` and `/api/program/runs` are one
       character apart and one of them lists rather than starts. */
    expect(post.url).toBe('/api/program/run');

    const program = (post.body as { program: Program }).program;
    expect(program.name).toBe('harden login');
    expect(program.nodes.map((n) => n.kind)).toEqual(['start', 'agent', 'end']);
    expect(program.nodes.find((n) => n.kind === 'agent')?.agent?.prompt).toBe(
      'add rate limiting to POST /login',
    );

    /* THE SERVER RUNS THIS EXACT CHECK AND 400s ON FAILURE. Asserting it here
       means a malformed program is a red test rather than a refusal the reader
       has to decode. */
    const validation = validateProgram(program);
    expect(validation.ok, validation.ok ? '' : validation.errors.join(' · ')).toBe(true);
  });

  it('opens the run the ENGINE named, and asks the list again', async () => {
    /*
     * NO OPTIMISTIC STATUS. The 202 acknowledges; the subsequent GET
     * establishes. The route's own comment says why it is not a 200 — "a 200
     * here would read as done, which is the one thing it is not" — so the
     * client's job on success is to go and ask.
     */
    const calls = stubFetch((_url, method) =>
      method === 'POST' ? { status: 202, body: ACCEPTED } : { status: 200, body: NO_RUNS },
    );

    await openTheForm();
    const before = calls.filter((c) => c.method === 'GET').length;
    fill('n', 'i');
    fireEvent.click(screen.getByTestId(ACTIVITY.authorStart));

    await waitFor(() => {
      /* The new run is opened by id... */
      expect(calls.some((c) => c.url.includes(ACCEPTED.runId))).toBe(true);
      /* ...and the list is re-asked rather than patched locally. */
      expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(before);
    });
  });

  it('a REFUSAL keeps the form up with what they wrote still in it', async () => {
    /*
     * The likeliest refusal is the ACP gate — the route answers 403 "ACP is not
     * available" — and that is a thing the reader goes away and fixes. A form
     * that closed on refusal would make them type the instruction again, and
     * the instruction is the whole of the run.
     */
    stubFetch((_url, method) =>
      method === 'POST'
        ? { status: 403, body: { error: 'ACP is not available' } }
        : { status: 200, body: NO_RUNS },
    );

    await openTheForm();
    fill('n', 'the long instruction they typed');
    fireEvent.click(screen.getByTestId(ACTIVITY.authorStart));

    await waitFor(() => {
      expect(screen.getByTestId(ACTIVITY.authorFailure).textContent).toBe('ACP is not available');
    });
    /* Still on the form, still holding the words. */
    expect(screen.getByTestId(ACTIVITY.author)).toBeTruthy();
    expect((screen.getByTestId(ACTIVITY.authorInstruction) as HTMLTextAreaElement).value).toBe(
      'the long instruction they typed',
    );
  });

  it('PREFLIGHT names ACP unavailable before Start — without a wasted POST', async () => {
    const calls = stubFetch((_url, method) =>
      method === 'POST'
        ? { status: 500, body: { error: 'should not POST' } }
        : { status: 200, body: NO_RUNS },
      { acp: 'unavailable' },
    );

    await openTheForm();
    await waitFor(() => {
      expect(screen.getByTestId(ACTIVITY.authorAcpNote).textContent).toBe('ACP is not available');
    });
    expect(calls.some((c) => c.url === '/api/acp/available')).toBe(true);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('PREFLIGHT names an empty agent registry before Start', async () => {
    stubFetch((_url, _method) => ({ status: 200, body: NO_RUNS }), { acp: 'no-agents' });

    await openTheForm();
    await waitFor(() => {
      expect(screen.getByTestId(ACTIVITY.authorAcpNote).textContent).toMatch(
        /No local ACP agent is registered/i,
      );
    });
  });

  it('QUOTES THE ENGINE, never a status code', async () => {
    /* `wireMessage`'s rule, applied at a new call site: the engine's sentence
       is the only part of a refusal that says what to do next. */
    stubFetch((_url, method) =>
      method === 'POST'
        ? { status: 400, body: { error: 'no repository attached' } }
        : { status: 200, body: NO_RUNS },
    );

    await openTheForm();
    fill('n', 'i');
    fireEvent.click(screen.getByTestId(ACTIVITY.authorStart));

    await waitFor(() => {
      const said = screen.getByTestId(ACTIVITY.authorFailure).textContent ?? '';
      expect(said).toBe('no repository attached');
      expect(said).not.toMatch(/400/);
    });
  });

  it('SENDS NOTHING when the form is empty, and says both things that are wrong', async () => {
    const calls = stubFetch(() => ({ status: 200, body: NO_RUNS }));

    await openTheForm();
    fireEvent.click(screen.getByTestId(ACTIVITY.authorStart));

    const problems = await screen.findByTestId(ACTIVITY.authorProblems);
    expect(problems.querySelectorAll('li')).toHaveLength(2);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('Back returns to the list without starting anything', async () => {
    const calls = stubFetch(() => ({ status: 200, body: NO_RUNS }));

    await openTheForm();
    fireEvent.click(screen.getByTestId(ACTIVITY.authorBack));

    expect(screen.queryByTestId(ACTIVITY.author)).toBeNull();
    expect(screen.getByTestId(ACTIVITY.newRun)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('the list is NOT on screen while the form is', async () => {
    /* Two surfaces in one overlay, one at a time — the same rule the shell
       applies to overlays themselves, one level down. */
    stubFetch(() => ({ status: 200, body: NO_RUNS }));
    await openTheForm();
    expect(screen.queryByTestId(ACTIVITY.bucketBar)).toBeNull();
    expect(screen.queryByTestId(ACTIVITY.refresh)).toBeNull();
  });
});

describe('steering a run that is already going', () => {
  /*
   * `shouldPause` reached the runner at last, so a run CAN pause between steps
   * and "Waiting on you" can finally be non-zero. No client posted to either
   * route, so nothing could put a run into that state — the producer existed
   * and the door did not.
   */
  /* THE WIRE SHAPE, from the lane s own fixture — a hand-written summary that
     drops a field the pane reads renders no row at all, which is exactly what
     the first cut of these tests did. */
  const RUN = (status: ProgramRunStatus) =>
    summary({ runId: ACCEPTED.runId, programName: 'nightly', status });

  /** Answers the list with one run in `status`, and its detail likewise. */
  function withOneRun(status: ProgramRunStatus, onPost: (url: string) => { status: number; body: unknown }) {
    return stubFetch((url, method) => {
      if (method === 'POST') return onPost(url);
      if (url.includes(ACCEPTED.runId)) {
        /* The DETAIL is a ProgramRunRecord, not a summary - the lane's own
           fixture is the only shape that stays right when the wire changes. */
        return { status: 200, body: detail({ runId: ACCEPTED.runId, status }) };
      }
      return { status: 200, body: { runs: [RUN(status)] } };
    });
  }

  async function openTheRun() {
    render(<ConnectedActivity now={() => 1_000} pollMs={0} />);
    const row = await screen.findByTestId(ACTIVITY.row);
    fireEvent.click(row);
    return screen.findByTestId(ACTIVITY.detail);
  }

  it('PAUSE REACHES THE ENGINE, at the exact route', async () => {
    const calls = withOneRun('running', () => ({ status: 200, body: {} }));
    await openTheRun();

    fireEvent.click(await screen.findByTestId(ACTIVITY.pause));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST');
      expect(post?.url).toBe(`/api/program/runs/${ACCEPTED.runId}/pause`);
    });
  });

  it('RESUME REACHES THE ENGINE, at the exact route', async () => {
    const calls = withOneRun('paused', () => ({ status: 200, body: {} }));
    await openTheRun();

    fireEvent.click(await screen.findByTestId(ACTIVITY.resume));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST');
      expect(post?.url).toBe(`/api/program/runs/${ACCEPTED.runId}/resume`);
    });
  });

  it('CANCEL REQUIRES CONFIRMATION before it reaches the engine', async () => {
    const calls = withOneRun('running', () => ({
      status: 200,
      body: { cancelled: true, status: 'running' },
    }));
    await openTheRun();

    const cancel = await screen.findByTestId(ACTIVITY.cancel);
    expect(cancel.textContent).toBe('Cancel run');
    expect(cancel.className).not.toMatch(/fail|wont|solid|danger|red/i);
    fireEvent.click(cancel);

    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    const confirm = screen.getByTestId(ACTIVITY.cancelConfirm);
    expect(confirm.textContent).toBe('Stop run');
    expect(confirm.className).not.toMatch(/fail|wont|solid|danger|red/i);
    expect(screen.getByTestId(ACTIVITY.cancelGate).textContent).toMatch(
      /changes already written.*remain/i,
    );

    fireEvent.click(confirm);
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST');
      expect(post?.url).toBe(`/api/program/runs/${ACCEPTED.runId}/cancel`);
    });
  });

  it.each<ProgramRunStatus>(['paused', 'completed', 'failed', 'stopped', 'interrupted'])(
    'offers no Cancel action when the engine reports %s',
    async (status) => {
      withOneRun(status, () => ({ status: 200, body: {} }));
      await openTheRun();
      expect(screen.queryByTestId(ACTIVITY.cancel)).toBeNull();
      expect(screen.queryByTestId(ACTIVITY.cancelGate)).toBeNull();
    },
  );

  it('offers PAUSE on a running run and never RESUME', async () => {
    /*
     * The control is derived from the engine's status, not from what the reader
     * last clicked. Both on screen at once would be a panel asking a question
     * only one answer of which can be true.
     */
    withOneRun('running', () => ({ status: 200, body: {} }));
    await openTheRun();
    expect(await screen.findByTestId(ACTIVITY.pause)).toBeTruthy();
    expect(screen.queryByTestId(ACTIVITY.resume)).toBeNull();
  });

  it('offers RESUME on a paused run and never PAUSE', async () => {
    withOneRun('paused', () => ({ status: 200, body: {} }));
    await openTheRun();
    expect(await screen.findByTestId(ACTIVITY.resume)).toBeTruthy();
    expect(screen.queryByTestId(ACTIVITY.pause)).toBeNull();
  });

  it('offers NEITHER on a finished run', async () => {
    withOneRun('completed', () => ({ status: 200, body: {} }));
    await openTheRun();
    expect(screen.queryByTestId(ACTIVITY.pause)).toBeNull();
    expect(screen.queryByTestId(ACTIVITY.resume)).toBeNull();
  });

  it('ASKS AGAIN after a successful steer rather than painting the new state', async () => {
    /*
     * `programRunner.pause` sets a flag the scheduler reads BETWEEN STEPS, so a
     * run pauses when it reaches a boundary and not when the button is clicked.
     * A UI that painted "Paused" on the click would be describing an intention
     * as a fact — the same defect the start path refuses one screen back.
     */
    const calls = withOneRun('running', () => ({ status: 200, body: {} }));
    await openTheRun();
    const before = calls.filter((c) => c.method === 'GET').length;

    fireEvent.click(await screen.findByTestId(ACTIVITY.pause));

    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(before);
    });
  });

  it('ASKS AGAIN after Cancel and keeps status engine-authored', async () => {
    const calls = withOneRun('running', () => ({
      status: 200,
      body: { cancelled: true, status: 'running' },
    }));
    await openTheRun();
    const before = calls.filter((c) => c.method === 'GET').length;

    fireEvent.click(await screen.findByTestId(ACTIVITY.cancel));
    fireEvent.click(screen.getByTestId(ACTIVITY.cancelConfirm));

    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(before);
    });
    expect(screen.getByTestId(ACTIVITY.row).dataset.status).toBe('running');
  });

  it('quotes a refusal to pause, in the engine s own words', async () => {
    withOneRun('running', () => ({ status: 409, body: { error: 'that run has already finished' } }));
    await openTheRun();

    fireEvent.click(await screen.findByTestId(ACTIVITY.pause));

    await waitFor(() => {
      expect(screen.getByTestId(ACTIVITY.steerFailure).textContent).toBe(
        'that run has already finished',
      );
    });
  });
});

describe('a halted run is picked back up, and a live one keeps telling the truth', () => {
  /*
   * ══ WHAT WAS MEASURED, AND WHAT IT COST ═══════════════════════════════
   *
   * `programRunner.resume` accepted `paused` and refused everything else,
   * while `scheduler.ts` documents its own contract as "paused = user/soft
   * halt, resumable; stopped = budget/abort (also resumable)" and writes a
   * complete checkpoint for both. `interrupted` is `reconcile()`'s verdict on
   * a record whose driver went away — its checkpoint is whole too. So a run
   * halted at minute 55 by the ten-minute budget, or by a dev-server restart,
   * had fifty-four minutes of completed nodes and paid-for provider answers on
   * disk and NO BUTTON. The engine accepts all three now; this is the door.
   */
  const RUNID = ACCEPTED.runId;

  /** One run in `status`, whose record carries (or does not carry) a checkpoint. */
  function withRun(status: ProgramRunStatus, over: Record<string, unknown> = {}) {
    return stubFetch((url, method) => {
      if (method === 'POST') return { status: 200, body: {} };
      if (url.includes(RUNID)) {
        return { status: 200, body: detail({ runId: RUNID, status, ...over }) };
      }
      return { status: 200, body: { runs: [summary({ runId: RUNID, programName: 'nightly', status })] } };
    });
  }

  async function open() {
    render(<ConnectedActivity now={() => 1_000} pollMs={0} />);
    fireEvent.click(await screen.findByTestId(ACTIVITY.row));
    return screen.findByTestId(ACTIVITY.detail);
  }

  it.each<ProgramRunStatus>(['paused', 'stopped', 'interrupted'])(
    'offers Resume on a %s run that has a checkpoint',
    async (status) => {
      withRun(status);
      await open();
      expect(await screen.findByTestId(ACTIVITY.resume)).toBeTruthy();
    },
  );

  it('POSTs to the resume route from a stopped run', async () => {
    const calls = withRun('stopped');
    await open();
    fireEvent.click(await screen.findByTestId(ACTIVITY.resume));
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST');
      expect(post?.url).toBe(`/api/program/runs/${RUNID}/resume`);
    });
  });

  it("offers no Resume when the engine's record carries no checkpoint", async () => {
    /* The engine refuses this one — "no node ever reached a terminal status,
       so there is nothing to resume FROM" — and a button whose only possible
       outcome is a refusal is worse than no button. */
    withRun('paused', { checkpoint: undefined });
    await open();
    expect(screen.queryByTestId(ACTIVITY.resume)).toBeNull();
  });

  it.each<ProgramRunStatus>(['completed', 'completed-with-violations', 'failed'])(
    'offers no Resume on a %s run, because the engine will not restart one',
    async (status) => {
      withRun(status);
      await open();
      expect(screen.queryByTestId(ACTIVITY.resume)).toBeNull();
    },
  );

  it('KEEPS READING THE OPEN RUN while it advances, instead of freezing at the click', async () => {
    /*
     * ══ THE PANEL THAT SHOWED STEP 12 AT STEP 87 ══════════════════════════
     *
     * The detail effect depended on `[client, openId, reopen]`, and `reopen`
     * is bumped only after a pause/resume/cancel POST. The 2.5s poll bumps
     * `asked`, which only the LIST effect read. So the one screen built to
     * answer "what is this run doing right now" answered "what was it doing
     * when you opened it", and the row behind it kept counting up while the
     * panel in front did not move.
     *
     * Asserted as the engine's own answer CHANGING under a stationary panel:
     * the second read reports a node the first did not, and the panel must
     * show it without the reader closing and reopening the run.
     */
    let reads = 0;
    const calls = stubFetch((url, method) => {
      if (method === 'POST') return { status: 200, body: {} };
      if (url.includes(RUNID)) {
        reads += 1;
        const events = detail({ runId: RUNID, status: 'running' }).events;
        return {
          status: 200,
          body:
            reads === 1
              ? detail({ runId: RUNID, status: 'running' })
              : {
                  ...detail({ runId: RUNID, status: 'running' }),
                  events: [
                    ...events,
                    { seq: 5, at: 1_700_000_004_000, type: 'node:status', nodeId: 'n3', status: 'done' },
                  ],
                },
        };
      }
      return {
        status: 200,
        body: { runs: [summary({ runId: RUNID, programName: 'nightly', status: 'running' })] },
      };
    });

    /* A real poll interval, because the defect is precisely that the poll did
       not reach this effect. */
    render(<ConnectedActivity now={() => 1_000} pollMs={10} />);
    fireEvent.click(await screen.findByTestId(ACTIVITY.row));
    await screen.findByTestId(ACTIVITY.detail);

    /* n3 is absent from the first answer — the fixture's log says nothing
       about it — so this can only pass if the panel re-read. */
    await waitFor(
      () => {
        const n3 = screen
          .getAllByTestId(ACTIVITY.detailNode)
          .find((el) => el.dataset.nodeId === 'n3');
        expect(n3?.dataset.nodeStatus).toBe('done');
      },
      { timeout: 3_000 },
    );
    expect(calls.filter((c) => c.url.includes(RUNID)).length).toBeGreaterThan(1);
  });
});

describe('a run can be given a budget, which is the only way past ten minutes', () => {
  /*
   * ══ THE CAP NOBODY COULD RAISE ════════════════════════════════════════
   *
   * `PostProgramRunRequest` has accepted `timeoutMs` and `maxSteps` since the
   * route was written, and NO CLIENT SENT EITHER — `grep` over this package
   * found neither field anywhere in the run path. So every run started from
   * the product was held to the runner's ten-minute wall clock, the node in
   * flight lost its race at exactly ten minutes and was recorded as an error,
   * and the run ended `stopped`. A two-hour agentic task was not expressible.
   *
   * These drive the REAL form and read the REAL request body, so they fail if
   * the select, the handler, the client argument or the JSON key is
   * disconnected at any joint.
   */
  async function startWith(budget?: { time?: string; steps?: string }) {
    const calls = stubFetch((_url, method) =>
      method === 'POST' ? { status: 202, body: ACCEPTED } : { status: 200, body: NO_RUNS },
    );
    await openTheForm();
    fill('long job', 'refactor the analyzer package and verify it');
    if (budget?.time !== undefined) {
      fireEvent.change(screen.getByTestId(ACTIVITY.authorTimeBudget), {
        target: { value: budget.time },
      });
    }
    if (budget?.steps !== undefined) {
      fireEvent.change(screen.getByTestId(ACTIVITY.authorStepBudget), {
        target: { value: budget.steps },
      });
    }
    fireEvent.click(screen.getByTestId(ACTIVITY.authorStart));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')).toBeTruthy();
    });
    return calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
  }

  it('SENDS THE CHOSEN BUDGET, in the fields the route already accepted', async () => {
    /* Index 2 of RUN_TIME_BUDGETS is two hours; index 2 of RUN_STEP_BUDGETS is
       2000 steps. Both are read off the model rather than retyped, so a change
       to the offered list cannot make this test assert a number the form does
       not offer. */
    const body = await startWith({ time: '2', steps: '2' });
    expect(body.timeoutMs).toBe(RUN_TIME_BUDGETS[2].value);
    expect(body.maxSteps).toBe(RUN_STEP_BUDGETS[2].value);
    expect(body.timeoutMs).toBe(2 * 60 * 60 * 1000);
  });

  it('sends NOTHING when the reader chose nothing, so the engine owns its own default', async () => {
    /*
     * Not the same as sending 600000. The default is the ENGINE's number and
     * it lives there; a client that restates it has quietly become the place
     * that decides it, and the two drift the first time one of them moves.
     */
    const body = await startWith();
    expect('timeoutMs' in body).toBe(false);
    expect('maxSteps' in body).toBe(false);
    expect(body.program).toBeTruthy();
  });
});
