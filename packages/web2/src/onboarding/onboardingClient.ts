/* ══════════════════════════════════════════════════════════════════════════
   FIRST RUN — the wire
   packages/web2/src/onboarding/onboardingClient.ts

   Two read-only routes the server already has (analyzer
   server/onboardingRoutes.ts):

     GET /api/onboarding/providers[?refresh=1]  which agent CLIs are here
     GET /api/onboarding/repos                  git repos under home

   Relative paths only, so a request can never leave the page's own origin.
   Every failure is a value, never a throw: the first-run screen draws an
   answer for each list whatever the wire did.
   ══════════════════════════════════════════════════════════════════════════ */

/** Round 7 (A4): `adapter` = signed in, but the bridge Sequence drives it through is missing. */
export const PROVIDER_STATES = ['checking', 'install', 'signIn', 'ready', 'adapter', 'limited', 'attention', 'preparing', 'update'] as const;
export type ProviderState = (typeof PROVIDER_STATES)[number];

export interface ProviderStatus {
  id: string;
  label: string;
  installed: boolean;
  version: string | null;
  state: ProviderState;
  /** The vendor's own sign-in command (`claude auth login`). */
  signInCommand: string;
  /** The official install command. Shown to copy, never run by Sequence. */
  installHint: string;
  /** Account kind ("ChatGPT"); never an email. */
  plan?: string;
  /**
   * The bridge's install command, which Install bridge runs on a click. Set whenever the
   * bridge is missing, whatever the sign-in state: on `adapter` it is the only step left,
   * on `signIn` the card offers bridge and sign-in as one step.
   */
  adapterInstall?: string;
  /** Which bridge drives the CLI: `bundled` ships inside the app (nothing to install), `global` is one the person installed. */
  bridge?: 'bundled' | 'downloaded' | 'global';
  /** State `preparing`: compressed bytes of the bridge fetched so far. */
  setupBytes?: number;
  /** The first-use fetch failed; the global install is offered instead. */
  setupError?: string;
  /** State `update`: the oldest Claude Code Sequence drives. */
  minVersion?: string;
  /** The bridge is missing whatever the sign-in state: one button does the missing steps in order. */
  bridgeMissing?: boolean;
  /** State `limited`: the usage limit is spent until this time (epoch ms), from the last failed turn. */
  limitResetsAt?: number;
  /** Installed but older than the version Sequence recommends: still usable, with an Update button (analyzer agentVersions.ts). */
  updateAvailable?: { recommended: string; command: string };
  /** Client only: the vendor read signed-out right after a sign-in, so it is being asked again (signInState). */
  checkingSignIn?: boolean;
}

/** "Oct 12, 4:36 PM", in the viewer's own time. */
export function resetLabel(at: number, locale?: string): string {
  return new Date(at).toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Round 7 (A4): the bridge install, as the server reports it while it runs. */
export interface BridgeInstallStatus {
  state: 'idle' | 'running' | 'done' | 'failed';
  command?: string;
  output?: string[];
  exitCode?: number | null;
  error?: string;
}

export interface DiscoveredRepo {
  path: string;
  name: string;
  lastActive: number | null;
  recent: boolean;
}

export interface ReposAnswer {
  repos: DiscoveredRepo[];
  truncated: boolean;
}

/** A skill folder or instruction file the server found on this machine (never its contents). */
export interface FoundSkill {
  path: string;
  shown: string;
  kind: 'skill' | 'instructions';
  folder: boolean;
  slug: string;
  bytes: number;
  /** Which tool's place it came from (the server sets it). */
  source?: 'claude' | 'codex' | 'cursor' | 'project';
}

export interface SkillsFound {
  /** `words` when something typed was not a path: the step then says which folders it will look in. */
  mode: 'default' | 'paths' | 'words';
  looked: string[];
  unknown: string[];
  candidates: FoundSkill[];
  truncated: boolean;
  skipped: string[];
  /** One plain line per typed place that gave nothing, with the reason. */
  notes?: string[];
}

export interface SkillsImported {
  imported: string[];
  kept: string[];
  problems: string[];
}

export type Answer<T> = { ok: true; body: T } | { ok: false; message: string; /** The server needs a project open first (skills import). */ needsProject?: boolean; /** No HTTP answer came (offline, reload): the request may be tried again. */ networkError?: boolean };

/** One MCP server or skill found in ~/.claude or ~/.codex. Names only, never a definition. */
export interface SetupItem {
  name: string;
  source: 'claude' | 'codex';
}

export interface SetupInventory {
  mcpServers: SetupItem[];
  skills: SetupItem[];
}

export const PROVIDERS_ROUTE = '/api/onboarding/providers';
export const REPOS_ROUTE = '/api/onboarding/repos';
export const SETUP_ROUTE = '/api/onboarding/setup';

async function getJson<T>(fetchImpl: typeof fetch, route: string): Promise<Answer<T>> {
  try {
    const res = await fetchImpl(route, { headers: { accept: 'application/json' } });
    const body = (await res.json().catch(() => null)) as (T & { error?: unknown }) | null;
    if (!res.ok) {
      const msg = body && typeof body.error === 'string' ? body.error : `request failed (${res.status})`;
      return { ok: false, message: msg };
    }
    if (body === null) return { ok: false, message: 'the server did not answer with JSON' };
    return { ok: true, body };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'the server could not be reached', networkError: true };
  }
}

export interface OnboardingClient {
  providers(refresh?: boolean): Promise<Answer<ProviderStatus[]>>;
  repos(): Promise<Answer<ReposAnswer>>;
  /** Optional so older fakes and hosts without the route still type-check. */
  setup?(): Promise<Answer<SetupInventory>>;
  /** Round 7 (A4): start the bridge install (only ever on a person's click), and read its progress. */
  installBridge?(provider: string): Promise<Answer<BridgeInstallStatus>>;
  bridgeStatus?(provider: string): Promise<Answer<BridgeInstallStatus>>;
  /** Claims-audit 4.2: install the agent's own CLI with the vendor's native installer (only ever on a click), and read its progress. */
  installCli?(provider: string): Promise<Answer<BridgeInstallStatus>>;
  cliStatus?(provider: string): Promise<Answer<BridgeInstallStatus>>;
  /** Skills import: look (read-only) for skill and instruction files named by `text`, then import the confirmed paths. */
  skillsFind?(text: string): Promise<Answer<SkillsFound>>;
  skillsImport?(text: string, selected: string[]): Promise<Answer<SkillsImported>>;
  /** Take back skills this person just brought in: only folders in the project's .sequence/skills, by name. */
  skillsRemove?(names: string[]): Promise<Answer<{ removed: string[] }>>;
}

export const SKILLS_FIND_ROUTE = '/api/onboarding/skills/find';
export const SKILLS_IMPORT_ROUTE = '/api/onboarding/skills/import';
export const SKILLS_REMOVE_ROUTE = '/api/onboarding/skills/remove';

async function postJson<T>(fetchImpl: typeof fetch, route: string, payload: unknown): Promise<Answer<T>> {
  try {
    const res = await fetchImpl(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = (await res.json().catch(() => null)) as (T & { error?: string; needsProject?: boolean }) | null;
    /* A 5xx with no readable body is the server or the line failing, not an answer to the request: like a throw, the
       caller may try again (a saved skills import is kept for the next attempt). */
    if (!body && res.status >= 500) return { ok: false, message: `request failed (${res.status})`, networkError: true };
    if (!res.ok || !body) return { ok: false, message: body?.error ?? `request failed (${res.status})`, ...(body?.needsProject ? { needsProject: true } : {}) };
    return { ok: true, body };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'the server could not be reached', networkError: true };
  }
}

export const BRIDGE_ROUTE = '/api/onboarding/install-adapter';

export function createOnboardingClient(fetchImpl: typeof fetch = (...a) => fetch(...a)): OnboardingClient {
  return {
    async providers(refresh = false) {
      const a = await getJson<{ providers: ProviderStatus[] }>(fetchImpl, refresh ? `${PROVIDERS_ROUTE}?refresh=1` : PROVIDERS_ROUTE);
      return a.ok ? { ok: true, body: Array.isArray(a.body.providers) ? a.body.providers : [] } : a;
    },
    async repos() {
      const a = await getJson<ReposAnswer>(fetchImpl, REPOS_ROUTE);
      return a.ok
        ? { ok: true, body: { repos: Array.isArray(a.body.repos) ? a.body.repos : [], truncated: a.body.truncated === true } }
        : a;
    },
    async installBridge(provider) {
      try {
        const res = await fetchImpl(BRIDGE_ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider }) });
        const body = (await res.json().catch(() => null)) as (BridgeInstallStatus & { error?: string }) | null;
        if (!res.ok || !body) return { ok: false, message: body?.error ?? `request failed (${res.status})` };
        return { ok: true, body };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : 'the server could not be reached' };
      }
    },
    async installCli(provider) {
      return postJson<BridgeInstallStatus>(fetchImpl, BRIDGE_ROUTE, { provider, kind: 'cli' });
    },
    async cliStatus(provider) {
      return getJson<BridgeInstallStatus>(fetchImpl, `${BRIDGE_ROUTE}?provider=${encodeURIComponent(provider)}&kind=cli`);
    },
    async bridgeStatus(provider) {
      return getJson<BridgeInstallStatus>(fetchImpl, `${BRIDGE_ROUTE}?provider=${encodeURIComponent(provider)}`);
    },
    async skillsFind(text) {
      return postJson<SkillsFound>(fetchImpl, SKILLS_FIND_ROUTE, { text });
    },
    async skillsImport(text, selected) {
      return postJson<SkillsImported>(fetchImpl, SKILLS_IMPORT_ROUTE, { text, selected });
    },
    async skillsRemove(names) {
      return postJson<{ removed: string[] }>(fetchImpl, SKILLS_REMOVE_ROUTE, { names });
    },
    async setup() {
      const a = await getJson<SetupInventory>(fetchImpl, SETUP_ROUTE);
      if (!a.ok) return a;
      const list = (v: unknown): SetupItem[] =>
        Array.isArray(v)
          ? v
              .filter((x): x is SetupItem => !!x && typeof x.name === 'string' && (x.source === 'claude' || x.source === 'codex'))
              .map((x) => ({ name: x.name, source: x.source }))
          : [];
      return { ok: true, body: { mcpServers: list(a.body.mcpServers), skills: list(a.body.skills) } };
    },
  };
}

/**
 * The pill a provider card wears: the word, and the status tone. Ready names
 * the account kind when the vendor said one ("Codex · ChatGPT").
 */
/**
 * Round 7 (A4): one plain sentence per state, under the agent's name. The
 * adapter sentence is the owner's wording.
 */
/** "12 MB" (one decimal under 10 MB): the size of what has been fetched. */
export function setupSize(bytes: number): string {
  const mb = bytes / 1e6;
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** The first-use download failed: the reason in plain words, and the way out. */
function downloadFailed(reason: string): string {
  return `Couldn't download the Claude bridge: ${reason}. Install it with npm instead (the button does it).`;
}

export function providerSentence(
  p: Pick<ProviderStatus, 'state' | 'label' | 'limitResetsAt'> & { bridgeMissing?: boolean; checkingSignIn?: boolean; version?: string | null; minVersion?: string; setupError?: string },
): string {
  if (p.state === 'checking' && p.checkingSignIn) return 'Checking sign-in...';
  switch (p.state) {
    case 'preparing':
      return `Setting up ${p.label}. Nothing to do; this takes a moment the first time.`;
    case 'update':
      return `${p.label} ${p.version ?? ''} is older than Sequence can drive${p.minVersion ? ` (${p.minVersion} or newer)` : ''}. Update it to keep going.`.replace('  ', ' ');
    case 'limited':
      return `${p.label} is signed in, but its usage limit is spent${p.limitResetsAt ? ` until ${resetLabel(p.limitResetsAt)}` : ''}. It can take work again after that.`;
    case 'ready':
      return 'Signed in and ready to take work.';
    case 'signIn':
      return p.bridgeMissing
        ? p.setupError
          ? `${p.label} is installed but signed out. ${downloadFailed(p.setupError)}`
          : `${p.label} is installed but signed out, and Sequence needs its small bridge (claude-agent-acp) to talk to it. One button does both.`
        : `${p.label} is installed but signed out. Sign in to use it.`;
    case 'adapter':
      if (p.setupError) return downloadFailed(p.setupError);
      return "Sequence talks to Claude Code through a small bridge called claude-agent-acp. It isn't installed yet.";
    case 'install':
      return `${p.label} is not on this machine.`;
    case 'attention':
      return `Couldn’t check whether ${p.label} is signed in. Try Sign in.`;
    default:
      return 'Looking at this machine.';
  }
}

export function providerPill(p: ProviderStatus): { text: string; tone: 'done' | 'attention' | 'limit' | 'failed' | 'neutral' } {
  if (p.state === 'checking' && p.checkingSignIn) return { text: 'Checking sign-in', tone: 'neutral' };
  switch (p.state) {
    case 'preparing':
      return { text: p.setupBytes ? `Setting up Claude… ${setupSize(p.setupBytes)}` : 'Setting up Claude…', tone: 'neutral' };
    case 'update':
      return { text: 'Update Claude Code', tone: 'attention' };
    case 'ready':
      return { text: p.plan ? `Ready, ${p.plan}` : 'Ready', tone: 'done' };
    case 'signIn':
      /* The action is the button beside it; the pill states the fact. */
      return { text: p.bridgeMissing ? 'Needs sign-in and bridge' : 'Needs sign-in', tone: 'neutral' };
    case 'adapter':
      return { text: 'Needs bridge', tone: 'attention' };
    case 'limited':
      return { text: p.limitResetsAt ? `Usage limit, resets ${resetLabel(p.limitResetsAt)}` : 'Usage limit', tone: 'limit' };
    case 'install':
      return { text: 'Not installed', tone: 'neutral' };
    case 'attention':
      return { text: 'Needs attention', tone: 'failed' };
    default:
      return { text: 'Checking', tone: 'neutral' };
  }
}
