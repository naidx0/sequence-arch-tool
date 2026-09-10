/**
 * Live research gateway — fetch real URLs / search results, then ask the user's
 * configured provider for a brief that cites ONLY what was actually fetched.
 *
 * Honesty rails (non-negotiable):
 *   - never invent source URLs;
 *   - failed fetches are reported, not papered over;
 *   - private / loopback targets are refused (SSRF);
 *   - without a provider the caller must refuse before invoking this.
 */

/** One attempted fetch — ok or not. Citations in the brief come only from ok:true. */
export interface FetchedSource {
  url: string;
  ok: boolean;
  status?: number;
  title?: string;
  /** Plain text excerpt (truncated). Absent when ok is false. */
  text?: string;
  error?: string;
}

export interface LiveResearchCitation {
  url: string;
  ok: boolean;
  title?: string;
  error?: string;
}

export interface LiveResearchResult {
  title: string;
  /** Repo-relative path under `.sequence/decisions/`. */
  path: string;
  markdown: string;
  citations: LiveResearchCitation[];
  /** Short assistant bubble text. */
  text: string;
}

export type FetchImpl = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;
const MAX_SOURCES = 5;
const MAX_PAGE_BYTES = 48_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_EXCERPT_CHARS = 6_000;

/** Extract http(s) URLs from free text; de-dupe; strip trailing punctuation. */
export function extractUrls(text: string): string[] {
  const found = text.match(URL_RE) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of found) {
    const cleaned = raw.replace(/[.,;:!?)]+$/, '');
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

/**
 * Test-only seam: `SEQUENCE_RESEARCH_ALLOW_LOOPBACK` may list one exact URL
 * (or comma-separated) that is otherwise loopback-blocked. Production never sets this.
 */
function isAllowlistedLoopback(raw: string): boolean {
  const rawList = (process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK ?? '').trim();
  if (!rawList) return false;
  return rawList.split(',').map((s) => s.trim()).filter(Boolean).includes(raw);
}

/**
 * SSRF guard — only public http(s) hosts. Loopback, RFC1918, link-local,
 * metadata, and non-http schemes are refused before any fetch.
 */
export function isSafePublicHttpUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'not a valid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: `refused scheme ${url.protocol}` };
  }
  const host = url.hostname.toLowerCase();
  const loopbackHost =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host === 'metadata.google.internal' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost');
  if (loopbackHost) {
    if (isAllowlistedLoopback(raw)) {
      return { ok: true, url };
    }
    return { ok: false, error: 'refused private/loopback host' };
  }
  // IPv4 private / link-local / CGNAT
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10 || a === 127 || a === 0) {
      return { ok: false, error: 'refused private/loopback host' };
    }
    if (a === 169 && b === 254) {
      return { ok: false, error: 'refused link-local host' };
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return { ok: false, error: 'refused private/loopback host' };
    }
    if (a === 192 && b === 168) {
      return { ok: false, error: 'refused private/loopback host' };
    }
    if (a === 100 && b >= 64 && b <= 127) {
      return { ok: false, error: 'refused carrier-grade NAT host' };
    }
  }
  return { ok: true, url };
}

/** Strip tags / scripts for a readable excerpt. Best-effort, not a browser. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function titleFromHtml(html: string): string | undefined {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const t = m?.[1]?.replace(/\s+/g, ' ').trim();
  return t || undefined;
}

export async function fetchUrlContent(
  rawUrl: string,
  opts: { fetchImpl?: FetchImpl; maxBytes?: number; timeoutMs?: number } = {},
): Promise<FetchedSource> {
  const safe = isSafePublicHttpUrl(rawUrl);
  if (!safe.ok) {
    return { url: rawUrl, ok: false, error: safe.error };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxBytes = opts.maxBytes ?? MAX_PAGE_BYTES;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(safe.url.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { accept: 'text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.1' },
    });
    if (!res.ok) {
      return {
        url: safe.url.toString(),
        ok: false,
        status: res.status,
        error: `HTTP ${res.status}`,
      };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const slice = buf.subarray(0, maxBytes).toString('utf8');
    const ctype = (res.headers.get('content-type') ?? '').toLowerCase();
    const looksHtml = ctype.includes('html') || /^\s*</.test(slice);
    const title = looksHtml ? titleFromHtml(slice) : undefined;
    const text = (looksHtml ? htmlToPlainText(slice) : slice).slice(0, MAX_EXCERPT_CHARS);
    if (!text.trim()) {
      return {
        url: safe.url.toString(),
        ok: false,
        status: res.status,
        title,
        error: 'empty body after fetch',
      };
    }
    return {
      url: safe.url.toString(),
      ok: true,
      status: res.status,
      title,
      text,
    };
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message;
    return { url: safe.url.toString(), ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * DuckDuckGo Instant Answer JSON — returns real FirstURL / AbstractURL values.
 * Never invents links: empty RelatedTopics ⇒ empty list (caller says so).
 */
export async function searchWebUrls(
  query: string,
  opts: { fetchImpl?: FetchImpl; maxResults?: number } = {},
): Promise<{ urls: string[]; error?: string }> {
  const q = query.trim();
  if (!q) return { urls: [], error: 'empty search query' };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxResults = opts.maxResults ?? MAX_SOURCES;
  const endpoint =
    'https://api.duckduckgo.com/?q=' +
    encodeURIComponent(q) +
    '&format=json&no_redirect=1&no_html=1';
  try {
    const res = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      return { urls: [], error: `search HTTP ${res.status}` };
    }
    const body = (await res.json()) as {
      AbstractURL?: string;
      Results?: Array<{ FirstURL?: string }>;
      RelatedTopics?: Array<{ FirstURL?: string; Topics?: Array<{ FirstURL?: string }> }>;
    };
    const urls: string[] = [];
    const push = (u?: string) => {
      if (!u || !u.startsWith('http')) return;
      if (urls.includes(u)) return;
      if (urls.length >= maxResults) return;
      const safe = isSafePublicHttpUrl(u);
      if (safe.ok) urls.push(safe.url.toString());
    };
    push(body.AbstractURL);
    for (const r of body.Results ?? []) push(r.FirstURL);
    for (const t of body.RelatedTopics ?? []) {
      push(t.FirstURL);
      for (const nested of t.Topics ?? []) push(nested.FirstURL);
    }
    return { urls };
  } catch (e) {
    return { urls: [], error: (e as Error).message };
  }
}

export function decisionPathForResearchTitle(title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'research';
  return `.sequence/decisions/${slug}.md`;
}

export function buildLiveResearchPrompt(args: {
  query: string;
  sources: FetchedSource[];
  digestSummary?: string;
}): string {
  const ok = args.sources.filter((s) => s.ok && s.text);
  const lines: string[] = [
    'You are writing a LIVE RESEARCH brief for Sequence.',
    'Cite ONLY the numbered SOURCES below. Do not invent URLs, papers, or vendors.',
    'If a claim is not in the sources, say "not in fetched sources".',
    'Keep the brief structured: Goal, Findings, Trade-offs, Open questions, Sources.',
    '',
    `QUERY: ${args.query.trim()}`,
    '',
  ];
  if (args.digestSummary?.trim()) {
    lines.push('ATTACHED REPO DIGEST (grounding — not a web source):', args.digestSummary.trim(), '');
  }
  if (ok.length === 0) {
    lines.push(
      'SOURCES: none fetched successfully.',
      'Say honestly that no web sources were retrieved and list what failed if known.',
      'Do not invent replacements.',
    );
  } else {
    lines.push(`SOURCES (${ok.length} fetched):`);
    ok.forEach((s, i) => {
      lines.push(`[${i + 1}] ${s.url}${s.title ? ` — ${s.title}` : ''}`);
      lines.push(s.text!);
      lines.push('');
    });
  }
  return lines.join('\n');
}

/**
 * Assemble durable markdown. The Sources section lists ONLY URLs we actually
 * attempted; ok ones are "Cited"; failures are "Fetch failed" with the error.
 */
export function assembleLiveResearchMarkdown(args: {
  query: string;
  modelText: string;
  sources: FetchedSource[];
}): LiveResearchResult {
  const topic = args.query.trim().slice(0, 80) || 'topic';
  const title = `Live research: ${topic}`;
  const path = decisionPathForResearchTitle(title);
  const citations: LiveResearchCitation[] = args.sources.map((s) => ({
    url: s.url,
    ok: s.ok,
    title: s.title,
    error: s.error,
  }));

  const lines: string[] = [
    `# ${title}`,
    '',
    '## Goal',
    '',
    args.query.trim() || '_No query provided._',
    '',
    '## Brief',
    '',
    args.modelText.trim() || '_Model returned empty text._',
    '',
    '## Sources (fetched)',
    '',
  ];
  if (args.sources.length === 0) {
    lines.push('_No URLs were fetched — paste https:// links or retry when search is reachable._');
    lines.push('');
  } else {
    for (const s of args.sources) {
      if (s.ok) {
        lines.push(`- [ok] [${s.title ?? s.url}](${s.url})`);
      } else {
        lines.push(`- [fail] ${s.url} — fetch failed${s.error ? `: ${s.error}` : ''}`);
      }
    }
    lines.push('');
  }
  lines.push('## Honesty');
  lines.push('');
  lines.push(
    'Only URLs listed above were requested. Failed fetches are not treated as sources. Nothing was invented to fill gaps.',
  );
  lines.push('');
  lines.push('## Promote-to-implementation checklist');
  lines.push('');
  lines.push('- [ ] Confirm claims against cited URLs');
  lines.push('- [ ] Switch Assistant to **Build** when ready to change code');
  lines.push('');

  const okCount = citations.filter((c) => c.ok).length;
  const markdown = lines.join('\n').trim();
  const text =
    okCount > 0
      ? `Live research brief for **${topic}** — ${okCount} source${okCount === 1 ? '' : 's'} fetched; opened at \`${path}\`.`
      : `Live research attempted for **${topic}** but no sources fetched successfully — see the brief at \`${path}\` for failures.`;

  return { title, path, markdown, citations, text };
}

/**
 * Full pipeline: resolve URLs (explicit + extracted + optional search) → fetch →
 * model → durable brief. Injectable fetch for locking tests.
 */
export async function runLiveResearch(args: {
  query: string;
  urls?: string[];
  digestSummary?: string;
  callModel: (prompt: string) => Promise<string>;
  fetchImpl?: FetchImpl;
}): Promise<LiveResearchResult> {
  const query = args.query.trim();
  if (!query) {
    return assembleLiveResearchMarkdown({
      query: '',
      modelText: 'No research query provided.',
      sources: [],
    });
  }

  const explicit = [...(args.urls ?? []), ...extractUrls(query)];
  const uniqueExplicit: string[] = [];
  for (const u of explicit) {
    if (!uniqueExplicit.includes(u)) uniqueExplicit.push(u);
  }

  let candidateUrls = uniqueExplicit.slice(0, MAX_SOURCES);
  let searchError: string | undefined;
  if (candidateUrls.length === 0) {
    // Strip chip preamble-ish noise for search: keep the human query.
    const searchQ = query
      .replace(/^Live web research on\s+/i, '')
      .replace(/:\s*fetch real sources[\s\S]*$/i, '')
      .trim() || query;
    const searched = await searchWebUrls(searchQ, { fetchImpl: args.fetchImpl });
    searchError = searched.error;
    candidateUrls = searched.urls.slice(0, MAX_SOURCES);
  }

  const sources: FetchedSource[] = [];
  for (const u of candidateUrls) {
    sources.push(await fetchUrlContent(u, { fetchImpl: args.fetchImpl }));
  }

  if (sources.length === 0 && searchError) {
    sources.push({
      url: '(web search)',
      ok: false,
      error: searchError,
    });
  }

  const prompt = buildLiveResearchPrompt({
    query,
    sources,
    digestSummary: args.digestSummary,
  });
  const modelText = await args.callModel(prompt);
  return assembleLiveResearchMarkdown({ query, modelText, sources });
}
