import { useCallback, useEffect, useRef, useState } from 'react';

import { createSettingsClient, type LocalSetupPlanView, type PullStateView } from './settingsClient';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * ONE CLICK TO A LOCAL MODEL
 *
 * Owner, 2026-09-19: "also render in a one-click local AI setup like Hermes
 * does I think with Magnitude Dev — research and make sure we can do that now."
 *
 * ── WHAT THE FORM BELOW IT USED TO ASK FOR ────────────────────────────────
 *
 * Provider, base URL, model id, and an API key box — for a model already
 * running on the reader's own machine. Settings could detect Ollama, and what
 * it did with the detection was print `ollama serve` and
 * `ollama pull <model-name>` and ask them to open a terminal. A local-first
 * product whose local path goes through a terminal is a local-first product on
 * paper.
 *
 * ── WHAT THIS DOES, AND THE HALF OF MAGNITUDE IT DOES NOT COPY ───────────
 *
 * Magnitude profiles the machine and estimates tokens/second for every model
 * and quant before anything is downloaded. WE DO NOT ESTIMATE SPEED — that
 * needs a measured throughput model, and a made-up figure is the exact thing
 * this product exists to catch in other tools. `localSetup.ts` carries the
 * argument.
 *
 * What is left is still the whole of the reader's problem: is there something
 * here that runs, does it FIT in this machine's memory, and can the app do the
 * rest without a terminal. One button, three answers.
 *
 * IT NEVER INSTALLS OLLAMA. Running somebody else's installer is not a button
 * this product gets to own; when Ollama is absent the answer is a link and a
 * sentence, and the person decides.
 * ══════════════════════════════════════════════════════════════════════════
 */

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * IS THIS ACTUALLY A PLAN?
 *
 * ── THE FAULT THIS EXISTS TO PREVENT, WHICH HAS HAPPENED HERE BEFORE ──────
 *
 * On 2026-09-19 the Settings pane went BLANK because a fixture answered
 * `/api/skills` with a body of a different shape and the component that read
 * it threw — taking permissions, MCP and autonomy down with it, none of which
 * had anything to do with skills. One card's bad payload is not allowed to
 * cost the reader the pane.
 *
 * It is not only a test concern. A packaged app talks to whatever server is on
 * the machine, and an older one answers 404 with an HTML body or 200 with
 * `{}`. `plan.machine.totalMemoryBytes` on either of those is a TypeError
 * during render, which React escalates to unmounting the whole tree.
 *
 * SO THE CARD TRUSTS NOTHING IT DID NOT CHECK. Narrow, boring, and it only
 * has to be right about the three fields that are read.
 */
function asPlan(body: unknown): LocalSetupPlanView | null {
  if (typeof body !== 'object' || body === null) return null;
  const row = body as { outcome?: unknown; machine?: unknown };
  const machine = row.machine;
  if (typeof machine !== 'object' || machine === null) return null;
  if (typeof (machine as { totalMemoryBytes?: unknown }).totalMemoryBytes !== 'number') return null;
  if (typeof (machine as { cpus?: unknown }).cpus !== 'number') return null;
  if (row.outcome === 'ready') {
    return typeof (body as { model?: unknown }).model === 'string' &&
      typeof (body as { bytes?: unknown }).bytes === 'number'
      ? (body as LocalSetupPlanView)
      : null;
  }
  if (row.outcome === 'needs-model') {
    return typeof (body as { recommended?: unknown }).recommended === 'string' &&
      Array.isArray((body as { installed?: unknown }).installed)
      ? (body as LocalSetupPlanView)
      : null;
  }
  if (row.outcome === 'needs-ollama') {
    return typeof (body as { downloadUrl?: unknown }).downloadUrl === 'string'
      ? (body as LocalSetupPlanView)
      : null;
  }
  return null;
}

/** How often the download is re-read while it is running. */
const PULL_POLL_MS = 700;

export function LocalSetupCard({ onDone }: { onDone?: () => void }) {
  const client = useRef(createSettingsClient()).current;
  const [plan, setPlan] = useState<LocalSetupPlanView | null>(null);
  const [pull, setPull] = useState<PullStateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const answer = await client.localPlan();
    if (answer.outcome !== 'ok') {
      setPlan(null);
      setError(answer.message);
      return;
    }
    const parsed = asPlan(answer.body);
    if (parsed === null) {
      /* A server that answered something else is a server that does not have
         this route. Say so once and stop: a card that retried would poll a
         404 for the life of the session. */
      setPlan(null);
      setError('This build of the engine does not offer local setup.');
      return;
    }
    setPlan(parsed);
    setError(null);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * THE POLL STOPS ITSELF. A download is minutes and a finished one is
   * forever; an interval that kept running after `done` would be a request a
   * second for the rest of the session, on the one screen a person leaves
   * open while they wait.
   */
  useEffect(() => {
    if (pull?.state !== 'pulling') return undefined;
    const timer = setInterval(() => {
      void (async () => {
        const answer = await client.pullState();
        if (answer.outcome !== 'ok') return;
        setPull(answer.body);
        if (answer.body.state === 'done') {
          await load();
          onDone?.();
        }
      })();
    }, PULL_POLL_MS);
    return () => clearInterval(timer);
  }, [client, load, onDone, pull?.state]);

  const act = useCallback(
    async (model: string) => {
      setBusy(true);
      setError(null);
      const answer = await client.setUpLocal(model);
      setBusy(false);
      if (answer.outcome !== 'ok') {
        setError(answer.message);
        return;
      }
      if (answer.body.outcome === 'ready') {
        await load();
        onDone?.();
        return;
      }
      setPull({ state: 'pulling', model, status: 'starting' });
    },
    [client, load, onDone],
  );

  if (plan === null && error !== null) {
    /* KNOWN-BAD IS NOT LOADING. A skeleton that never resolves is the shape a
       reader waits on for ever; one line and a retry is what a dead end owes
       them. */
    return (
      <div className="settings-local-setup" data-testid="settings-local-setup">
        <p className="settings-local-head">Run a model on this machine</p>
        <p className="settings-profile-meta">{error}</p>
        <div className="settings-profile-acts">
          <button
            type="button"
            className="settings-btn"
            data-testid="settings-local-recheck"
            onClick={() => void load()}
          >
            Check again
          </button>
        </div>
      </div>
    );
  }

  if (plan === null) {
    /*
     * A SKELETON, NOT A SPINNER AND NOT NOTHING (the kit's `loading/skeleton`).
     * This card's height is known before its content is, so reserving it stops
     * the pane from jumping when the answer lands — and a jumping pane is what
     * makes a fast read feel slower than a slow one.
     */
    return (
      <div className="settings-local-setup" data-testid="settings-local-setup" aria-busy="true">
        <div className="settings-skel l60" />
        <div className="settings-skel l90" />
        <div className="settings-skel l40" />
      </div>
    );
  }

  const machine = plan.machine;
  const machineLine = `${gb(machine.totalMemoryBytes)} of memory · ${machine.cpus} cores`;

  if (pull && pull.state !== 'idle' && pull.state !== 'done') {
    const pct =
      pull.state === 'pulling' && pull.total && pull.completed !== undefined && pull.total > 0
        ? Math.min(100, Math.round((pull.completed / pull.total) * 100))
        : null;
    return (
      <div className="settings-local-setup" data-testid="settings-local-setup">
        <p className="settings-local-head">
          {pull.state === 'error' ? 'The download stopped' : `Downloading ${pull.model}`}
        </p>
        {pull.state === 'error' ? (
          <p className="settings-profile-meta">{pull.message ?? pull.status}</p>
        ) : (
          <>
            {/* THE REAL TOTAL, FROM OLLAMA. No size is written into this app:
                a figure hard-coded here would rot the next time the tag is
                rebuilt, and the reader would be watching our stale number. */}
            <div className="settings-local-bar" data-testid="settings-local-bar">
              <span style={pct === null ? undefined : { width: `${pct}%` }} data-indeterminate={pct === null ? 'yes' : undefined} />
            </div>
            <p className="settings-profile-meta">
              {pull.status}
              {pull.total && pull.completed !== undefined
                ? ` · ${gb(pull.completed)} of ${gb(pull.total)}`
                : ''}
            </p>
          </>
        )}
        <p className="settings-profile-meta">You can close this; it keeps going.</p>
      </div>
    );
  }

  if (plan.outcome === 'ready') {
    return (
      <div className="settings-local-setup" data-testid="settings-local-setup">
        <p className="settings-local-head">A model on this machine is ready</p>
        <p className="settings-profile-meta">
          <b>{plan.model}</b> · {gb(plan.bytes)} · fits in {machineLine}
        </p>
        <div className="settings-profile-acts">
          <button
            type="button"
            className="settings-btn settings-btn-primary"
            data-testid="settings-local-use"
            disabled={busy}
            onClick={() => void act(plan.model)}
          >
            {busy ? 'Setting up…' : `Use ${plan.model}`}
          </button>
        </div>
        <p className="settings-profile-meta">No key, no account, nothing leaves this machine.</p>
      </div>
    );
  }

  if (plan.outcome === 'needs-model') {
    return (
      <div className="settings-local-setup" data-testid="settings-local-setup">
        <p className="settings-local-head">Download a model that fits</p>
        <p className="settings-profile-meta">
          {plan.installed.length === 0
            ? `Ollama is running with no models yet. On ${machineLine}, this is the one:`
            : `Nothing installed fits ${machineLine} with room to spare. This one does:`}
        </p>
        <p className="settings-profile-meta">
          <b>{plan.recommended}</b> — {plan.note}
        </p>
        <div className="settings-profile-acts">
          <button
            type="button"
            className="settings-btn settings-btn-primary"
            data-testid="settings-local-pull"
            disabled={busy}
            onClick={() => void act(plan.recommended)}
          >
            {busy ? 'Starting…' : `Download ${plan.recommended}`}
          </button>
        </div>
        {/* WHAT IS ALREADY HERE, so "nothing fits" is a claim the reader can
            check rather than one they have to take. */}
        {plan.installed.length > 0 ? (
          <p className="settings-profile-meta" data-testid="settings-local-installed">
            Already installed: {plan.installed.map((m) => `${m.name} (${gb(m.bytes)})`).join(', ')}
          </p>
        ) : null}
        {error ? <p className="settings-profile-meta">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="settings-local-setup" data-testid="settings-local-setup">
      <p className="settings-local-head">Run a model on this machine</p>
      <p className="settings-profile-meta">
        Sequence can drive a local model with no key and no account. It needs Ollama, which is
        not here yet — install it, then press Check again and the rest is one click.
      </p>
      <div className="settings-profile-acts">
        <a
          className="settings-btn settings-btn-primary"
          href={plan.downloadUrl}
          target="_blank"
          rel="noreferrer"
          data-testid="settings-local-get-ollama"
        >
          Get Ollama
        </a>
        <button
          type="button"
          className="settings-btn"
          data-testid="settings-local-recheck"
          onClick={() => void load()}
        >
          Check again
        </button>
      </div>
    </div>
  );
}
