/**
 * The LOCAL GitHub connect layer (v8 Phase D) — a bring-your-own Personal Access
 * Token, stored at the USER level, with the EXACT same key hygiene as the AI
 * provider key ({@link ./provider.ts}). This is a read-only capability: it lists
 * the token owner's repositories. There is NO clone, NO push, NO write to GitHub
 * in this round (connect + read only). It is emphatically NOT hosted OAuth (that
 * is deferred — see docs/v8-plain-english-plan.md).
 *
 * Key hygiene rules enforced here (identical to the AI key):
 *   - the token travels only in the request header this module builds
 *     (`authorization: Bearer <token>`); it is never placed in a URL, a log line,
 *     or a thrown error;
 *   - a {@link GithubError} carries only GitHub's *response* status/body — never
 *     the request headers — and GitHub authors that body, so it cannot contain the
 *     token we sent;
 *   - {@link redactGithubConfig} is the only shape ever returned to a client (a
 *     `••••1234` mask, never the raw token).
 *
 * HONEST TESTING BOUNDARY: no real GitHub token exists in this build environment,
 * and github.com cannot be reached/verified from the sandbox (the same class of
 * boundary as the AI provider and the Electron binary). The whole path is verified
 * against a MOCK substituted over the injectable {@link GithubFetch} seam; the real
 * call is the identical client path with the default `fetch`. This is documented as
 * verified-against-mock only, never against a live github.com.
 */

/** The persisted shape of `~/.sequence/github.json`. Holds the raw token; never returned unredacted. */
export interface GithubConfig {
  /** The bring-your-own Personal Access Token. Persisted ONLY to the user-level github.json. */
  token: string;
}

/** One repository as surfaced to the client (read-only, honest subset of GitHub's payload). */
export interface GithubRepo {
  fullName: string;
  cloneUrl: string;
  private: boolean;
}

/** GitHub's public REST host. FIXED (not caller-influenced), so the fetch is not an SSRF/DoS surface. */
const GITHUB_API_HOST = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
/** Cap the number of repos surfaced — a picker convenience, not a full mirror. */
const MAX_REPOS = 100;

/**
 * A GitHub-boundary failure. `status`/`body` describe GitHub's *response* only —
 * the request (and thus the token) is never captured here, exactly like
 * {@link ../server/provider.ProviderError}.
 */
export class GithubError extends Error {
  status?: number;
  body?: string;
  constructor(message: string, opts?: { status?: number; body?: string }) {
    super(message);
    this.name = 'GithubError';
    this.status = opts?.status;
    this.body = opts?.body;
  }
}

/**
 * The injection seam for the GitHub API call — mirrors how {@link buildPlainTree}
 * injects `callProvider`. The default is the platform `fetch`; tests substitute a
 * mock so the real github.com call is never made in the sandbox while the entire
 * client path (URL, the token-bearing Authorization header, status handling, JSON
 * parse) is still exercised. The response shape is the structural subset of the
 * standard `fetch` `Response` this module uses, so the real `fetch` satisfies it.
 */
export interface GithubFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export type GithubFetch = (
  url: string,
  init: { method: string; headers: Record<string, string> }
) => Promise<GithubFetchResponse>;

/** The real-network default: the platform `fetch`. The `Response` it returns satisfies {@link GithubFetchResponse}. */
export const defaultGithubFetch: GithubFetch = (url, init) => fetch(url, init);

/**
 * Strict shape-validation of a candidate GitHub config (a PUT body or an on-disk
 * github.json). Returns `{ config }` on success or `{ error }` with a caller-safe
 * message (never echoing the token). Mirrors {@link validateAiConfig}.
 */
export function validateGithubConfig(x: unknown): { config?: GithubConfig; error?: string } {
  if (!x || typeof x !== 'object') return { error: 'body must be a JSON object' };
  const o = x as Record<string, unknown>;
  if (typeof o.token !== 'string' || o.token.trim() === '') {
    return { error: 'token must be a non-empty string' };
  }
  // Trim only surrounding whitespace (a pasted PAT never contains internal spaces);
  // the token is otherwise stored verbatim, only ever written to github.json.
  return { config: { token: o.token.trim() } };
}

/**
 * The redacted view returned by every GET / PUT — the full token never crosses the
 * wire back to a client. Mirrors {@link redactAiConfig}'s `••••` + last4 mask.
 */
export function redactGithubConfig(cfg: GithubConfig): { connected: true; tokenMasked: string } {
  const last4 = cfg.token.length >= 4 ? cfg.token.slice(-4) : cfg.token;
  return { connected: true, tokenMasked: '••••' + last4 };
}

/**
 * List the token owner's repositories (read-only). Calls the GitHub REST API
 * through the injectable `doFetch`, carrying the token ONLY in the Authorization
 * header this function builds. Returns a bounded, honest subset. Throws a
 * {@link GithubError} (token-free) on a network failure, a non-2xx status, or an
 * unparseable/unexpected body — the caller turns that into a clean 502.
 */
export async function listGithubRepos(cfg: GithubConfig, doFetch: GithubFetch): Promise<GithubRepo[]> {
  const url = `${GITHUB_API_HOST}/user/repos?per_page=${MAX_REPOS}&sort=updated`;
  let res: GithubFetchResponse;
  try {
    res = await doFetch(url, {
      method: 'GET',
      headers: {
        // The token rides ONLY here. GitHub requires a User-Agent; without it the
        // API replies 403. The Accept/version headers pin the stable REST shape.
        authorization: `Bearer ${cfg.token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'sequence',
        'x-github-api-version': GITHUB_API_VERSION,
      },
    });
  } catch (e) {
    // Network/DNS errors never carry our request headers; surface only the reason.
    throw new GithubError(`GitHub request failed: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    // GitHub-authored response body; it cannot contain the token we sent.
    throw new GithubError(`GitHub returned HTTP ${res.status}`, { status: res.status, body: text });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GithubError('GitHub response was not valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new GithubError('unexpected GitHub response (expected a repository array)');
  }
  const repos: GithubRepo[] = [];
  for (const r of parsed) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const fullName = typeof o.full_name === 'string' ? o.full_name : undefined;
    const cloneUrl = typeof o.clone_url === 'string' ? o.clone_url : undefined;
    if (!fullName || !cloneUrl) continue;
    repos.push({ fullName, cloneUrl, private: o.private === true });
    if (repos.length >= MAX_REPOS) break;
  }
  return repos;
}
