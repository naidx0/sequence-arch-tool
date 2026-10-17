import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createReaClient, type ReaClient, type ReaView, type StepId, type StepState } from './reaClient';
import './reaRow.css';

/**
 * REA (Reverse Engineer Anything) as an optional component, one row in Settings, MCP servers.
 *
 * TWO CHOICES: Off (the default, nothing downloaded) and Start. Choosing Start only shows the plan: what is downloaded
 * from where (the GitHub repository at the pinned commit and, on Windows, the npm package with its native files, which
 * is checked against the registry's integrity value), the total size, where it goes, and that no admin rights are
 * needed. The one primary button, "Download and start", then does all of it, with a line per step. When it finishes
 * REA is added to this project's `.sequence/mcp.json` and the row says in plain words what works and what does not
 * (from `rea doctor --json`). Hopper, Ghidra, IDA and JADX are never installed here; the row only says so.
 *
 * Where there is no first-run or Components setup yet, this row in Settings is the only place; the Components list is a
 * later slice (docs/plans/components-plan.md, slice B).
 */

const STEP_WORDS: Record<StepState, string> = { pending: 'Waiting', running: 'Running', done: 'Done', failed: 'Failed' };

const short = (commit: string): string => commit.slice(0, 7);

const DOCTOR_STEP = { id: 'doctor' as const, label: 'Check what works on this machine (rea doctor)', command: 'rea doctor --json' };

const DEFAULT_STEPS: { id: StepId; label: string }[] = [
  { id: 'fetch', label: 'Download the pinned commit' },
  { id: 'install', label: "Install REA's locked dependencies" },
  { id: 'build', label: 'Build it' },
  { id: 'prune', label: 'Drop the build tools' },
  { id: 'addon', label: 'Add the Windows native files from npm' },
  { id: 'verify', label: 'Check that it starts' },
  DOCTOR_STEP,
];

export interface ReaComponentRowProps {
  client?: ReaClient;
  /** Called after the project's `.sequence/mcp.json` changed, so the editor below can read it again. */
  onChanged?: () => void;
  /** How often to ask about a running install, in ms. */
  pollMs?: number;
}

export function ReaComponentRow({ client, onChanged, pollMs = 1000 }: ReaComponentRowProps) {
  const api = useMemo(() => client ?? createReaClient(), [client]);
  const [view, setView] = useState<ReaView | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const live = useRef(true);
  const finished = useRef<string | null>(null);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const refresh = useCallback(
    async (withPlan = false): Promise<ReaView | null> => {
      const a = await api.view(withPlan);
      if (!live.current) return null;
      if (!a.ok) {
        /* An older server, or none: the row says nothing is wrong with the project, only that REA cannot be offered. */
        setNote(a.status === 404 || a.status === 0 ? null : a.message);
        return null;
      }
      setView((prev) => ({ ...a.body, plan: a.body.plan ?? prev?.plan }));
      return a.body;
    },
    [api],
  );

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  /* While an install runs, ask again. When it ends, add REA to the project once and say so. */
  const state = view?.job.state;
  useEffect(() => {
    if (state !== 'running') return undefined;
    const t = setInterval(() => void refresh(false), pollMs);
    return () => clearInterval(t);
  }, [state, refresh, pollMs]);

  useEffect(() => {
    if (!view || view.job.state !== 'done' || finished.current === view.pin.commit) return;
    finished.current = view.pin.commit;
    void (async () => {
      const added = await api.register();
      if (!live.current) return;
      setNote(added.ok ? null : added.message);
      setPlanOpen(false);
      onChanged?.();
      await refresh(false);
    })();
  }, [view, api, refresh, onChanged]);

  if (!view) {
    return (
      <div className="sb-row rea-row" data-testid="settings-rea" data-state="unknown">
        <div className="sb-row-hd">
          <span className="sb-row-t">REA, Reverse Engineer Anything</span>
        </div>
        <p className="sb-row-sub" data-testid="settings-rea-sub">
          {note ?? 'Reverse engineering for shipped apps and binaries. Optional, and off until you start it.'}
        </p>
      </div>
    );
  }

  const { pin, status, job } = view;
  const running = job.state === 'running';
  const failed = job.state === 'failed';
  const added = status.installed && status.registration === 'ours';
  const nativeMissing = status.installed && status.addon === 'missing';
  const label = running ? 'Starting' : status.installed ? 'On' : failed ? 'Failed' : 'Off';
  const stateKey = running ? 'starting' : added ? 'added' : status.installed ? 'installed' : failed ? 'failed' : 'off';
  const startSelected = status.installed || running || planOpen;

  const plan = view.plan;
  /* An install made before the native files were offered only needs those. */
  const planSteps = plan ? (nativeMissing ? plan.steps.filter((s) => s.id === 'addon') : plan.steps) : [];
  const known: { id: StepId; label: string; command?: string }[] = plan ? [...planSteps, DOCTOR_STEP] : DEFAULT_STEPS.filter((x) => x.id !== 'addon' || job.steps.addon !== undefined);
  /* Adding only the native files to an older install runs two steps, not the whole list. */
  const shownSteps = status.installed ? known.filter((x) => x.id === 'addon' || x.id === 'doctor') : known;
  const stepLabel = (id: string | undefined): string => (known.find((x) => x.id === id) ?? DEFAULT_STEPS.find((x) => x.id === id))?.label.replace(/.$/, '') ?? 'a step';
  const showPlan = planOpen && (!status.installed || nativeMissing) && !running && plan;

  const open = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    setArmed(false);
    const v = await refresh(true);
    setBusy(false);
    if (v) setPlanOpen(true);
  };
  const install = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    finished.current = null;
    const a = await api.install(pin.commit);
    setBusy(false);
    if (!live.current) return;
    if (!a.ok) {
      setNote(a.message);
      return;
    }
    setView((prev) => ({ ...a.body, plan: prev?.plan }));
  };
  const addToProject = async (): Promise<void> => {
    setBusy(true);
    const a = await api.register();
    setBusy(false);
    if (!live.current) return;
    setNote(a.ok ? null : a.message);
    onChanged?.();
    await refresh(false);
  };
  const remove = async (): Promise<void> => {
    setArmed(false);
    setBusy(true);
    const a = await api.remove();
    setBusy(false);
    if (!live.current) return;
    setNote(a.ok ? null : a.message);
    setPlanOpen(false);
    onChanged?.();
    await refresh(false);
  };
  const recheck = async (): Promise<void> => {
    if (!api.recheck) return;
    setBusy(true);
    const a = await api.recheck();
    setBusy(false);
    if (!live.current) return;
    if (!a.ok) {
      setNote(a.message);
      return;
    }
    setNote(null);
    setView((prev) => ({ ...a.body, plan: prev?.plan }));
  };
  const chooseOff = (): void => {
    if (running) return;
    if (status.installed) {
      setArmed(true);
      return;
    }
    setPlanOpen(false);
  };
  const chooseStart = (): void => {
    setArmed(false);
    if (!status.installed && !running && !planOpen) void open();
  };

  const doctor = status.doctor ?? null;
  const npm = plan?.addon ?? null;

  return (
    <div className="sb-row rea-row" data-testid="settings-rea" data-state={stateKey}>
      <div className="sb-row-hd">
        <span className="sb-row-t">REA, Reverse Engineer Anything</span>
        <span className="sb-badge" data-state="ready" data-testid="settings-rea-state">
          {label}
        </span>
      </div>
      <p className="sb-row-sub" data-testid="settings-rea-sub">
        Inspect a shipped app, binary or Electron bundle from the artifact itself, with the evidence for each answer. {pin.licence} licence, from github.com/morluto/rea.{startSelected ? '' : ' Off until you start it.'}
      </p>

      <div className="sb-seg rea-choice" role="group" aria-label="REA" data-testid="settings-rea-choice">
        <button type="button" className={!startSelected ? 'is-on' : undefined} aria-pressed={!startSelected} disabled={busy || running} data-testid="settings-rea-choice-off" onClick={chooseOff}>
          Off
        </button>
        <button type="button" className={startSelected ? 'is-on' : undefined} aria-pressed={startSelected} disabled={busy || running} data-testid="settings-rea-choice-start" onClick={chooseStart}>
          Start
        </button>
      </div>

      {added ? (
        <p className="sb-row-sub" data-testid="settings-rea-installed">
          Added to this project's .sequence/mcp.json. Version {status.version} at {short(status.commit ?? pin.commit)}
          {status.sizeMb !== null ? `, ${status.sizeMb} MB on disk` : ''}. Chat agents can use its {view.readOnlyTools} read-only tools through @reverse or /reverse-engineer.
        </p>
      ) : null}
      {status.installed && !added ? (
        <p className="sb-row-sub" data-testid="settings-rea-installed">
          {status.registration === 'other'
            ? 'Installed, but this project already has an MCP server named rea that Sequence did not add. Rename it to use this one.'
            : `Installed (version ${status.version} at ${short(status.commit ?? pin.commit)}). It is not in this project's MCP servers yet.`}
        </p>
      ) : null}

      {status.installed && !running ? (
        <div className="rea-caps" data-testid="settings-rea-caps">
          {doctor ? (
            <ul className="rea-caplist" data-testid="settings-rea-caplist">
              {doctor.lines.map((l) => (
                <li key={l} data-ok={/: (available|installed)\.$/.test(l) ? 'true' : 'false'}>
                  {l}
                </li>
              ))}
            </ul>
          ) : (
            <p className="sb-row-sub" data-testid="settings-rea-nodoctor">
              Not checked yet.
            </p>
          )}
          {nativeMissing ? (
            <p className="sb-row-sub" data-testid="settings-rea-nativemissing">
              This install lacks the Windows native files. Start adds them from npm.
            </p>
          ) : null}
        </div>
      ) : null}

      {running ? (
        <ol className="rea-steps" data-testid="settings-rea-steps" aria-live="polite">
          {shownSteps.map((s) => (
            <li key={s.id} data-state={job.steps[s.id] ?? 'pending'}>
              <span className="rea-step-t">
                {s.label}
                {job.steps[s.id] === 'running' && job.detail ? <span className="rea-step-d"> {job.detail}</span> : null}
              </span>
              <span className="rea-step-s">{STEP_WORDS[job.steps[s.id] ?? 'pending']}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {failed ? (
        <p className="sb-row-sub rea-err" role="alert" data-testid="settings-rea-error">
          Start stopped at: {stepLabel(job.failedStep)}. Nothing was installed. {job.error}
        </p>
      ) : null}

      {showPlan ? (
        <div className="rea-plan" data-testid="settings-rea-plan">
          <dl className="rea-facts">
            <dt>Downloads</dt>
            <dd data-testid="settings-rea-repo">{pin.repo.replace('https://', '')}</dd>
            <dt>Commit</dt>
            <dd className="mono" data-testid="settings-rea-commit" title={pin.commit}>
              {short(pin.commit)} (version {pin.version})
            </dd>
            {npm ? (
              <>
                <dt>And from npm</dt>
                <dd data-testid="settings-rea-npm">
                  {npm.package}@{npm.version}, for its two Windows native files. Checked against the sha512 the npm registry publishes for it before anything is opened. No package script runs.
                </dd>
              </>
            ) : null}
            <dt>Size</dt>
            <dd data-testid="settings-rea-size">
              About {plan.totalDownloadMb ?? pin.downloadMb} MB to download, about {plan.totalDiskMb ?? pin.diskMb} MB on disk
            </dd>
            <dt>Goes to</dt>
            <dd className="mono" title={plan.installDir}>
              {plan.installDir}
            </dd>
            <dt>Needs</dt>
            <dd data-testid="settings-rea-needs">{plan.requirements.map((r) => `${r.name}: ${r.ok ? 'ready' : 'missing'}`).join(', ')}. No admin rights.</dd>
          </dl>
          <ol className="rea-steps" data-testid="settings-rea-plan-steps">
            {[...planSteps, DOCTOR_STEP].map((s) => (
              <li key={s.id}>
                <span className="rea-step-t">{s.label}</span>
                <code className="rea-step-c">{s.command}</code>
              </li>
            ))}
          </ol>
          {plan.requirements.filter((r) => !r.ok).map((r) => (
            <p key={r.name} className="sb-row-sub rea-err" data-testid="settings-rea-missing">
              {r.detail}
            </p>
          ))}
          {plan.limitations.map((l) => (
            <p key={l} className="sb-row-sub" data-testid="settings-rea-limit">
              {l}
            </p>
          ))}
        </div>
      ) : null}

      {note ? (
        <p className="sb-row-sub rea-err" role="status" data-testid="settings-rea-note">
          {note}
        </p>
      ) : null}

      <div className="sb-acts-row rea-acts">
        {showPlan ? (
          <button type="button" className="s2-btn s2-blue" data-testid="settings-rea-install" disabled={busy || !plan.ready} onClick={() => void install()}>
            {nativeMissing ? 'Download and add' : 'Download and start'}
          </button>
        ) : null}
        {nativeMissing && !showPlan && !running ? (
          <button type="button" className="s2-btn s2-blue" data-testid="settings-rea-addnative" disabled={busy} onClick={() => void open()}>
            Add the Windows native files
          </button>
        ) : null}
        {status.installed && status.registration === 'absent' ? (
          <button type="button" className="s2-btn s2-blue" data-testid="settings-rea-register" disabled={busy} onClick={() => void addToProject()}>
            Add to this project
          </button>
        ) : null}
        {status.installed && !running && api.recheck ? (
          <button type="button" className="sb-pill sb-pill-quiet" data-testid="settings-rea-recheck" disabled={busy} onClick={() => void recheck()}>
            Check again
          </button>
        ) : null}
        {armed ? (
          <button type="button" className="sb-pill sb-pill-quiet" data-armed="true" data-testid="settings-rea-remove" disabled={busy} onClick={() => void remove()}>
            Turn off and delete REA
          </button>
        ) : null}
        {armed ? (
          <button type="button" className="sb-pill sb-pill-quiet" data-testid="settings-rea-keep" onClick={() => setArmed(false)}>
            Keep it
          </button>
        ) : null}
      </div>
    </div>
  );
}
