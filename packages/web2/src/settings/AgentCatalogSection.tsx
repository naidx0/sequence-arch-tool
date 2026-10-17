/* ══════════════════════════════════════════════════════════════════════════
   MORE AGENTS: EVERY ACP AGENT, ONE CLICK EACH
   packages/web2/src/settings/AgentCatalogSection.tsx

   Claude Code and Codex have their own rows above (their own sign-in and
   bridge flows). This section is everything else that speaks the Agent Client
   Protocol: Gemini CLI, Copilot, Cursor, OpenCode, Hermes, Qwen, Goose, and
   any agent the person adds to ~/.sequence/agent-catalog.json. Each row says
   in words how it would start here: Installed (its own CLI is on this
   machine), No install needed (it runs through npx), or Not installed (with
   how to get it). Connect registers it; Sign in starts the agent's OWN
   sign-in (ACP authenticate, which opens the browser for an "agent" method).
   The page only names an id, never a command line.

   `compact` (first run): only the agents that can start now, no Refresh, no
   install rows, so the welcome screen stays short.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';

import { S2Icon } from '../shell2/icons';
import { agentRuns, type AgentRunStore } from '../agents/agentRuns';
import { noteConnected } from '../agents/agentRegistry';
import { agentMark } from './logos/agentMark';
import { BrandMark } from './logos/BrandMark';
import { CATALOG_WORD, createCatalogClient, type AuthMethod, type CatalogClient, type CatalogRow, type InstallJob } from './agentCatalogClient';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface AgentCatalogSectionProps {
  client?: CatalogClient;
  fetchImpl?: Fetch;
  store?: AgentRunStore;
  /** First run: only what can start now, kept short. */
  compact?: boolean;
  onConnected?: (id: string) => void;
  /** How often a sign-in under way is asked about (ms). A test seam. */
  pollMs?: number;
  /** Compact: loaded but not drawn (first run's More agents is folded). */
  hidden?: boolean;
  /** Compact: how many agents can start now, so the host offers its toggle only when there are some. */
  onRows?: (count: number) => void;
  /**
   * The host already read the catalog (first run reads it once for this section and Ready in one click): use it
   * instead of fetching. null = that read is still under way. Absent = this section reads it itself.
   */
  preloaded?: { ok: true; rows: CatalogRow[] } | { ok: false; message: string } | null;
}

type SignIn =
  | { at: 'reading' }
  | { at: 'pick'; methods: AuthMethod[] }
  | { at: 'running'; method: string }
  | { at: 'done' }
  /* The agent declared no sign-in step: nothing to do here, and nothing was checked either. */
  | { at: 'none' }
  | { at: 'failed'; message: string };

/** The server gives a browser sign-in 10 minutes (agentCatalogRoutes SIGN_IN_MS); the page stops asking after that. */
const POLL_LIMIT_MS = 10 * 60_000;

const pageFetch: Fetch = (i, init) => fetch(i, init);

/* One list, two skins: the Settings pane's sb-* rows, and first run's fr-* type (onboarding.css). */
const SKIN = {
  settings: { list: 'sb-list', row: 'sb-row sb-agent sb-catalog-row', ic: 'sb-agent-ic sb-catalog-ic', txt: 'sb-row-txt', title: 'sb-row-t', sub: 'sb-row-sub', acts: 'sb-agent-acts', endActs: 'sb-agent-acts sb-catalog-acts', badge: 'sb-badge', primary: 'sb-pill sb-pill-solid', btn: 'sb-pill', fail: 'sb-fail' },
  firstRun: { list: 'fr-more-list', row: 'fr-more-row', ic: 'fr-more-ic', txt: 'fr-more-txt', title: 'fr-more-name', sub: 'fr-more-sub', acts: 'fr-more-acts', endActs: 'fr-more-acts fr-more-end', badge: 'fr-pill', primary: 'fr-btn', btn: 'fr-ghost', fail: 'fr-note fr-row-error' },
} as const;

export function AgentCatalogSection({ client: given, fetchImpl = pageFetch, store = agentRuns, compact = false, onConnected, pollMs = 1500, hidden = false, onRows, preloaded }: AgentCatalogSectionProps) {
  const client = useRef(given ?? createCatalogClient(fetchImpl)).current;
  const [rows, setRows] = useState<CatalogRow[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [moreOpen, setMoreOpen] = useState<string | null>(null);
  const [rowFail, setRowFail] = useState<Record<string, string>>({});
  const [signIn, setSignIn] = useState<Record<string, SignIn>>({});
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    if (preloaded !== undefined) return () => { live.current = false; };
    void client.list().then((a) => {
      if (!live.current) return;
      /* A body without a list (a server that answers every path the same) is no catalog, not a crash. */
      if (a.ok && Array.isArray(a.body.agents)) setRows(a.body.agents);
      else setFailure(a.ok ? 'the server sent no agent list' : a.message);
    });
    return () => {
      live.current = false;
    };
  }, [client, preloaded === undefined]);

  /* The host's single read, taken in as it lands. */
  useEffect(() => {
    if (!preloaded) return;
    if (preloaded.ok) setRows(preloaded.rows);
    else setFailure(preloaded.message);
  }, [preloaded]);

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    setRefreshNote(null);
    const a = await client.refresh();
    if (!live.current) return;
    setRefreshing(false);
    if (a.ok && Array.isArray(a.body.agents)) {
      setRows(a.body.agents);
      setRefreshNote(`Up to date: ${a.body.agents.length} agents.`);
    } else {
      if (Array.isArray(a.body?.agents)) setRows(a.body.agents);
      setRefreshNote('Could not check for new agents, so this is the list Sequence came with.');
    }
  };

  const connect = async (row: CatalogRow): Promise<void> => {
    setBusy(row.id);
    setRowFail(({ [row.id]: _gone, ...rest }) => rest);
    const a = await client.connect(row.id);
    if (!live.current) return;
    setBusy(null);
    if (!a.ok) {
      setRowFail((f) => ({ ...f, [row.id]: `Could not connect ${row.name}: ${a.message}` }));
      return;
    }
    setRows((rs) => (rs ?? []).map((r) => (r.id === row.id ? { ...r, state: 'connected' } : r)));
    /* The picker is told at once; its model list loads behind (that starts the agent, which can take most of a minute: Hermes measured ~45 s). Nothing waits on it. */
    void noteConnected(store, row.id, fetchImpl);
    onConnected?.(row.id);
  };

  /* One poll per agent at most; a closed row, an unmounted section or the server's own 10-minute window ends it (review finding 3). */
  const polls = useRef(new Map<string, () => void>());
  useEffect(() => () => {
    for (const stop of polls.current.values()) stop();
    polls.current.clear();
  }, []);
  const stopPoll = (id: string): void => {
    polls.current.get(id)?.();
    polls.current.delete(id);
  };
  const poll = useCallback(
    (id: string, method: string): void => {
      polls.current.get(id)?.();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stopped = false;
      const stop = (): void => {
        stopped = true;
        if (timer) clearTimeout(timer);
      };
      polls.current.set(id, stop);
      const until = Date.now() + POLL_LIMIT_MS;
      const end = (state: SignIn): void => {
        stop();
        polls.current.delete(id);
        if (live.current) setSignIn((s) => ({ ...s, [id]: state }));
      };
      const tick = async (): Promise<void> => {
        if (stopped || !live.current) return;
        const a = await client.job(id);
        if (stopped || !live.current) return;
        const job = a.ok ? a.body.job : undefined;
        if (!a.ok) return end({ at: 'failed', message: a.message });
        /* The server forgot it (it restarted): nothing is signing in any more. */
        if (!job || job.methodId !== method) return end({ at: 'failed', message: 'Sequence restarted before the sign-in finished; try again' });
        if (job.state === 'done') return end({ at: 'done' });
        if (job.state === 'failed') return end({ at: 'failed', message: job.error ?? 'the sign-in did not finish' });
        if (Date.now() > until) return end({ at: 'failed', message: 'the sign-in was not finished within 10 minutes' });
        timer = setTimeout(() => void tick(), pollMs);
      };
      timer = setTimeout(() => void tick(), pollMs);
    },
    [client, pollMs],
  );

  const startSignIn = async (row: CatalogRow): Promise<void> => {
    if (signIn[row.id] && signIn[row.id]!.at !== 'failed' && signIn[row.id]!.at !== 'done' && signIn[row.id]!.at !== 'none') {
      /* Closing the row ends what it was waiting on. */
      stopPoll(row.id);
      setSignIn(({ [row.id]: _gone, ...rest }) => rest);
      return;
    }
    setSignIn((s) => ({ ...s, [row.id]: { at: 'reading' } }));
    const a = await client.methods(row.id);
    if (!live.current) return;
    if (!a.ok) {
      /* Already signing in (a reload mid-sign-in): follow that one instead of starting another. */
      const job = (a.body as { job?: { methodId: string; state: string } } | undefined)?.job;
      if (job?.state === 'running') {
        setSignIn((s) => ({ ...s, [row.id]: { at: 'running', method: job.methodId } }));
        poll(row.id, job.methodId);
        return;
      }
      setSignIn((s) => ({ ...s, [row.id]: { at: 'failed', message: a.message } }));
      return;
    }
    const methods = Array.isArray(a.body.methods) ? a.body.methods : [];
    /* No method declared is not "signed in": nothing was checked (review finding 4). */
    if (methods.length === 0) {
      setSignIn((s) => ({ ...s, [row.id]: { at: 'none' } }));
      return;
    }
    setSignIn((s) => ({ ...s, [row.id]: { at: 'pick', methods } }));
  };

  const chooseMethod = async (row: CatalogRow, m: AuthMethod): Promise<void> => {
    setSignIn((s) => ({ ...s, [row.id]: { at: 'running', method: m.id } }));
    const a = await client.signIn(row.id, m.id);
    if (!live.current) return;
    if (!a.ok) {
      setSignIn((s) => ({ ...s, [row.id]: { at: 'failed', message: a.message } }));
      return;
    }
    poll(row.id, m.id);
  };

  /* Run in a sandbox: the same agent in a Docker container that sees only the project folder (`<id>-sandbox`). */
  const connectSandbox = async (row: CatalogRow): Promise<void> => {
    setBusy(`${row.id}-sandbox`);
    setRowFail(({ [row.id]: _gone, ...rest }) => rest);
    const a = await client.connect(row.id, 'docker');
    if (!live.current) return;
    setBusy(null);
    if (!a.ok) {
      setRowFail((f) => ({ ...f, [row.id]: `Could not start ${row.name} in a sandbox: ${a.message}` }));
      return;
    }
    const sid = a.body.agent?.id ?? `${row.id}-sandbox`;
    setRows((rs) => (rs ?? []).map((r) => (r.id === row.id ? { ...r, sandboxConnected: true } : r)));
    void noteConnected(store, sid, fetchImpl);
    onConnected?.(sid);
  };

  /* Install (agents that ship as an archive): one job per row, polled until done or failed, then the list is read again. */
  const [installing, setInstalling] = useState<Record<string, InstallJob>>({});
  const install = async (row: CatalogRow): Promise<void> => {
    setRowFail(({ [row.id]: _gone, ...rest }) => rest);
    const a = await client.install(row.id);
    if (!live.current) return;
    if (!a.ok) {
      setRowFail((f) => ({ ...f, [row.id]: `Install failed: ${a.message}` }));
      return;
    }
    follow(row.id, a.body.job);
  };
  /* Follow an install to its end: started here, or found under way when the list was read (a reload mid-download). */
  const follow = (id: string, first: InstallJob): void => {
    const row = { id };
    setInstalling((s) => ({ ...s, [row.id]: first }));
    const tick = async (): Promise<void> => {
      if (!live.current) return;
      const j = await client.installJob(row.id);
      if (!live.current) return;
      const job = j.ok ? j.body.job : undefined;
      if (!job) {
        setInstalling(({ [row.id]: _gone, ...rest }) => rest);
        setRowFail((f) => ({ ...f, [row.id]: `Install failed: ${j.ok ? 'Sequence restarted before it finished; try again' : j.message}` }));
        return;
      }
      setInstalling((s) => ({ ...s, [row.id]: job }));
      if (job.state === 'failed') {
        setInstalling(({ [row.id]: _gone, ...rest }) => rest);
        setRowFail((f) => ({ ...f, [row.id]: `Install failed: ${job.error ?? 'it did not finish'}` }));
        return;
      }
      if (job.state === 'done') {
        setInstalling(({ [row.id]: _gone, ...rest }) => rest);
        const fresh = await client.list();
        if (live.current && fresh.ok && Array.isArray(fresh.body.agents)) setRows(fresh.body.agents);
        return;
      }
      setTimeout(() => void tick(), pollMs);
    };
    setTimeout(() => void tick(), pollMs);
  };
  const followed = useRef(false);
  useEffect(() => {
    if (followed.current || !rows) return;
    followed.current = true;
    for (const r of rows) if (r.install && (r.install.state === 'downloading' || r.install.state === 'unpacking')) follow(r.id, r.install);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const startable = rows ? rows.filter((r) => r.state === 'ready' || r.state === 'npx' || r.state === 'uvx').length : 0;
  useEffect(() => {
    onRows?.(startable);
  }, [startable, onRows]);

  /* No catalog route (an older server) or hosted mode, where ACP agents are off: the section is simply not offered. */
  if (failure !== null) return null;
  if (rows === null) {
    return compact ? null : (
      <section className="sb-group" data-testid="agent-catalog">
        <h3 className="sb-lab">More agents</h3>
        <div className="sb-card">
          <p className="sb-note" data-testid="agent-catalog-loading">
            Reading the agent list…
          </p>
        </div>
      </section>
    );
  }

  const k = compact ? SKIN.firstRun : SKIN.settings;
  /* A connected agent already has its row (with Disconnect) in Coding agents above, and first run is past it: listed once. */
  const shown = compact ? rows.filter((r) => r.state === 'ready' || r.state === 'npx' || r.state === 'uvx').slice(0, 6) : rows.filter((r) => r.state !== 'connected');
  /* One primary per section (the Agents pane's rule): only the first agent that can connect gets the filled button. */
  const firstId = shown.find((r) => r.state !== 'install')?.id ?? null;
  if (compact && (shown.length === 0 || hidden)) return null;

  const renderRows = (rowsToShow: CatalogRow[], testid = 'agent-catalog-list') => (
    <ul className={k.list} data-testid={testid}>
      {rowsToShow.map((row) => {
        const si = signIn[row.id];
        return (
          <li key={row.id} className={k.row} data-testid="agent-catalog-row" data-agent={row.id} data-state={row.state}>
            {compact ? (
              <BrandMark id={row.id} mark={agentMark(row.id)} name={row.name} tile={k.ic} monoTile={k.ic} />
            ) : (
              <BrandMark id={row.id} mark={agentMark(row.id)} name={row.name} />
            )}
            <span className={k.txt}>
              <span className={k.title}>{row.name}</span>
              <span className={k.sub}>
                {row.state === 'mismatch' ? (row.mismatch ?? 'A different program with this name is on PATH; it did not answer as an agent') : row.state === 'install' ? (row.installable ? (row.description ?? '') : row.website ? `${row.description ? `${row.description}. ` : ''}Not on this machine yet.` : row.installHint) : (row.state === 'npx' || row.state === 'uvx') && !compact ? (row.description ?? '') : `${row.description ?? ''}${row.installedBySequence ? `${row.description ? '. ' : ''}Installed by Sequence${row.version ? `, version ${row.version}` : ''}.` : ''}`}
              </span>
              {!compact && row.sandbox && row.sandboxConnected ? (
                <span className={k.sub} data-testid="agent-catalog-sandbox-on">
                  Also connected in a sandbox: it sees only the project you open.
                </span>
              ) : null}
              {!compact && moreOpen === row.id && row.state !== 'install' && row.state !== 'mismatch' ? (
                <span className={k.acts} data-testid="agent-catalog-more-menu">
                  <button type="button" className={k.btn} data-testid="agent-catalog-signin" data-agent={row.id} aria-expanded={si?.at === 'pick'} onClick={() => void startSignIn(row)}>
                    Sign in
                  </button>
                  {row.sandbox && !row.sandboxConnected ? <button type="button" className={k.btn} data-testid="agent-catalog-sandbox" data-agent={row.id} disabled={busy !== null} title="Runs it in a Docker container that can read and write only the project you open" onClick={() => void connectSandbox(row)}>
                    {busy === `${row.id}-sandbox` ? 'Starting…' : 'Run in a sandbox'}
                  </button> : null}
                </span>
              ) : null}
              {si?.at === 'reading' ? (
                <span className={k.sub} data-testid="agent-catalog-signin-reading">
                  Starting {row.name} to ask how it signs in…
                </span>
              ) : null}
              {si?.at === 'pick' ? (
                <span className={k.acts} data-testid="agent-catalog-methods">
                  {si.methods.filter((m) => m.type === 'agent').map((m) => (
                    <button key={m.id} type="button" className={k.btn} data-testid="agent-catalog-method" data-method={m.id} title={m.description} onClick={() => void chooseMethod(row, m)}>
                      {m.name}
                    </button>
                  ))}
                </span>
              ) : null}
              {si?.at === 'pick' && si.methods.some((m) => m.type !== 'agent') ? (
                <span className={k.sub} data-testid="agent-catalog-methods-other">
                  {`Other ways to sign in: ${si.methods.filter((m) => m.type !== 'agent').map((m) => m.name).join(', ')}. Set those up in ${row.name} itself; Sequence cannot do them for you yet.`}
                </span>
              ) : null}
              {si?.at === 'none' ? (
                <span className={k.sub} data-testid="agent-catalog-signin-none">
                  {row.name} has no sign-in step here. If it needs an account or a key, it says so on its first run.
                </span>
              ) : null}
              {si?.at === 'running' ? (
                <span className={k.sub} data-testid="agent-catalog-signin-running">
                  Finish signing in where {row.name} opened it (usually your browser).
                </span>
              ) : null}
              {si?.at === 'done' ? (
                <span className={k.sub} data-testid="agent-catalog-signin-done">
                  Signed in.
                </span>
              ) : null}
              {si?.at === 'failed' ? (
                <span className={k.fail} role="alert" data-testid="agent-catalog-signin-failed">
                  Sign-in did not finish: {si.message}
                </span>
              ) : null}
              {installing[row.id] ? (
                <span className={k.sub} data-testid="agent-catalog-installing">
                  {installing[row.id]!.state === 'unpacking'
                    ? 'Checksum matches. Unpacking…'
                    : `Downloading${installing[row.id]!.totalBytes ? ` ${Math.round(installing[row.id]!.receivedBytes / 1e6)} of ${Math.round(installing[row.id]!.totalBytes! / 1e6)} MB` : ''}…`}
                </span>
              ) : null}
              {rowFail[row.id] ? (
                <span className={k.fail} role="alert" data-testid="agent-catalog-row-failure">
                  {rowFail[row.id]}
                </span>
              ) : null}
            </span>
            <span className={k.badge} data-tone={row.state === 'install' || row.state === 'mismatch' ? undefined : 'done'} data-state={row.state === 'connected' ? 'connected' : row.state === 'install' ? 'not-installed' : row.state === 'mismatch' ? 'mismatch' : 'ready'} data-testid="agent-catalog-status">
              {CATALOG_WORD[row.state]}
            </span>
            {row.state !== 'install' ? (
              <span className={k.endActs}>
                {row.state !== 'connected' ? (
                  <button type="button" className={compact || row.id === firstId ? k.primary : k.btn} data-testid="agent-catalog-connect" data-agent={row.id} disabled={busy !== null} onClick={() => void connect(row)}>
                    {busy === row.id ? 'Connecting…' : 'Connect'}
                  </button>
                ) : null}
                {!compact && row.state !== 'mismatch' ? (
                  <button type="button" className="s2-ibtn" data-testid="agent-catalog-more" data-agent={row.id} aria-label={`More for ${row.name}`} title="More" aria-expanded={moreOpen === row.id} onClick={() => setMoreOpen((m) => (m === row.id ? null : row.id))}>
                    <S2Icon name="more" />
                  </button>
                ) : null}
              </span>
            ) : row.installable && !compact ? (
              <span className={k.endActs}>
                <button type="button" className={k.btn} data-testid="agent-catalog-install" data-agent={row.id} disabled={installing[row.id] !== undefined} onClick={() => void install(row)}>
                  {installing[row.id] ? 'Installing…' : 'Install'}
                </button>
              </span>
            ) : row.website ? (
              <a className={k.btn} data-testid="agent-catalog-get" href={row.website} target="_blank" rel="noreferrer noopener">
                Get it
              </a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  if (compact) return <div className="fr-more" data-testid="agent-catalog-compact">{renderRows(shown)}</div>;

  /* Three groups, in the order a person wants them: ready now, one download away, and not here yet. */
  const GROUPS: { label: string; has: (r: CatalogRow) => boolean }[] = [
    /* A program with the agent's name that did not answer as one is on this machine too: it stays listed, in words. */
    { label: 'On this machine', has: (r) => r.state === 'ready' || r.state === 'mismatch' },
    { label: 'No install needed', has: (r) => r.state === 'npx' || r.state === 'uvx' },
    { label: 'Can be installed', has: (r) => r.state === 'install' },
  ];
  const q = query.trim().toLowerCase();
  const matches = (r: CatalogRow): boolean => q === '' || r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q);
  const grouped = GROUPS.map((g) => ({ label: g.label, rows: shown.filter((r) => g.has(r) && matches(r)) })).filter((g) => g.rows.length > 0);
  /* The search appears once there is more than the first group to look through. */
  const firstGroupSize = GROUPS[0]!.has(shown[0]!) ? shown.filter(GROUPS[0]!.has).length : 0;
  const searchable = shown.length > Math.max(firstGroupSize, 6);

  return (
    <section className="sb-group" data-testid="agent-catalog">
      <h3 className="sb-lab">More agents</h3>
      <div className="sb-card">
        <p className="sb-hint">Connect adds a coding agent here. One marked No install needed downloads itself the first time it starts, and Install fetches one that is not on this machine yet.</p>
        {searchable ? (
          <label className="sb-provcat-search">
            <span className="sb-copy-lab">Any agent ({shown.length})</span>
            <input type="search" className="sb-provcat-input" data-testid="agent-catalog-search" placeholder="Gemini, Cursor, Goose…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        ) : null}
        {grouped.map((g) => (
          <div key={g.label} className="sb-catalog-group" data-testid="agent-catalog-group" data-group={g.label}>
            <h4 className="sb-copy-lab sb-catalog-grp">{g.label}</h4>
            {renderRows(g.rows)}
          </div>
        ))}
        {grouped.length === 0 ? (
          <p className="sb-note" data-testid="agent-catalog-none">
            No agent matches "{query.trim()}".
          </p>
        ) : null}
        <p className="sb-note">
          <button type="button" className="sb-pill" data-testid="agent-catalog-refresh" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? 'Checking…' : 'Check for new agents'}
          </button>
          {refreshNote ? (
            <span className={k.sub} data-testid="agent-catalog-refresh-note">
              {' '}
              {refreshNote}
            </span>
          ) : null}
        </p>
      </div>
    </section>
  );
}

export default AgentCatalogSection;
