# Web search in the toolbelt — the field, the gap, the plan

> ## OWNER RULING, 2026-09-02 — BRING YOUR OWN PROVIDER
>
> Max, asked which provider to pick:
>
> > *"Whatever is free, people could collect on their own the cheapest one and the most efficient
> > one. They go, they connect on their own, not a problem. They do it on their own. We don't
> > really cry about that because we're not providing anything."*
>
> **Sequence ships no search account and pays for no one's queries.** That settles the question the
> plan below was holding open, and it settles it in the direction the local-first law already
> pointed:
>
> 1. **SearXNG stays the recommended default** — it is the only entry in the table that is
>    keyless, unlimited and local, so a user who connects nothing still gets search by pointing at
>    an instance. That is the "free" half of the ruling.
> 2. **Every hosted provider is BRING-YOUR-OWN-KEY** — Firecrawl, Tavily, Exa, Brave. The user
>    supplies the key the same way they supply an AI key today; it is stored the way that one is,
>    never bundled, never proxied through us, never in a receipt.
> 3. **No provider is a dependency of the product working.** With nothing configured, `web_search`
>    refuses honestly and names the two ways to turn it on — it never silently returns nothing,
>    which is the failure this repo's whole error posture exists to prevent.
>
> W4 in the build order below (the "optional, keyed" provider ring) is therefore not optional
> extra credit — it IS the shape, and the only thing that changes is that we never hold a key.

**Owner ask, 2026-09-02:** "see if you can use a browser search tool like Firecrawl or … Browser Use
… it basically lets you just use Google and search the browser. Very important … We need basic
agentic tools that help people do different types of work, like teaching, building, etc."

Measured 2026-09-02. Nothing built yet; this is the decision the build waits on.

## 1. Where we stand

Sequence's ask toolbelt has **one door to the web**: `fetch_url` (`askTools.ts` →
`executeFetchUrl` → `netFetchUrl`), SSRF-guarded, capped at `ASK_TOOL_FETCH_OUTPUT_CAP`, its body
wrapped as untrusted, gated by the permission `url` subject (`fetch_url(*)` rules work — G2).
The web2 Browser pane is the same door with a URL field (`/api/net-fetch`) — "allowlisted browse
tool + panel showing measured response, not embedded Chromium pretending to be a full browser."

There is **no search**. A teach turn or a research turn can read a URL it already knows and cannot
find one. That is the gap, and both harnesses we benchmark against have closed it:

- **Hermes** ships `web_search` + `web_extract` over a provider ring (Firecrawl default, SearXNG,
  Brave, DDGS, Exa, Tavily …), rotates a *keyless* ring on a fresh install, and returns page
  markdown with a deterministic head+tail truncation and a `[TRUNCATED]` footer that points at the
  cached full text.
- **OpenClaw** ships `web_search` over **SearXNG** — self-hosted, key-free, unlimited — via the
  JSON endpoint, `count` 1–10, one retry into `general`, brief in-process cache, and the same SSRF
  rule we have (HTTP only to loopback/private, HTTPS to public).

## 2. The field (2026-09, from vendor and independent write-ups)

| Tool | What it is | Cost | Keyless / self-host | Returns |
|---|---|---|---|---|
| **SearXNG** | Self-hosted metasearch over 70+ engines (Google, Bing, DDG, GitHub, arXiv…) | $0, AGPL | **Yes — no key, no per-query bill**; one Docker container, `format=json` | Ranked results + snippets |
| **Firecrawl** | Search + scrape in one call; full markdown per result; `github` / `research` / `pdf` categories; CLI installs into Claude Code / Cursor / Codex | 1K credits/mo free, then $83/mo | Open-source, self-hostable | Full page markdown |
| **Tavily** | RAG-shaped search API (acquired by Nebius, Feb 2026) | 1K/mo free, $0.008/credit | No | Snippets, optional raw |
| **Exa** | Neural / meaning-based search over its own index | 1K/mo free, $7/1K | No | Snippets, optional full text |
| **Brave Search API** | Independent index, low latency | $5/1K, no free tier since Feb 2026 | No | SERP JSON |
| **Jina Reader** | `r.jina.ai/<url>` → clean markdown of any page | free tier | No (hosted) | Page markdown |
| **Browser Use** | Open-source browser *agent* (drives a real browser; ~108k stars; 89% WebVoyager) | MIT; you pay the model | Yes | Whatever the agent does |
| **Stagehand / Browserbase** | act / extract / observe primitives over Playwright; managed browsers | OSS SDK; cloud paid | SDK yes; browsers paid | Structured extraction |

The name Max could not recall ("Fish something") is most likely one of **Firecrawl**, **Browserbase**
or **Exa**; none of the browsing tools is literally called Fish. Ask him with these in front of him.

## 3. The decision (recommended)

Two tools, one gate, keyless by default — the same shape both competitors converged on, and the
only one that survives our local-first law ("boots and delivers its core with no network and no key").

1. **`web_search(query, count≤10, category?)`** → **SearXNG** as the default provider, self-hosted
   in the same Docker we already require for benches (`searxng/searxng`, JSON format on). $0,
   no key, no query logs leaving the machine. Optional providers behind a config key, in this
   order of usefulness for *teaching*: **Firecrawl** (full markdown + `research`/`github`
   categories — the teach-mode "find a source and read it" turn in one call), then Tavily/Exa.
   A fresh install with no SearXNG and no key gets an honest refusal naming the two ways to turn
   it on — never a silent empty result.
2. **`web_read(url)`** = today's `fetch_url` upgraded: readability-style main-content extraction
   to markdown (local, no hosted reader), Hermes's truncation contract (complete under N chars;
   otherwise head+tail with an explicit `[TRUNCATED]` footer and the full text cached under
   `.sequence/web/` so `read_file` can page it). Keep the SSRF guard, the untrusted wrap, and the
   `url` permission subject exactly as they are.
3. **Permission:** `web_search` gets a `query` subject so `deny web_search(*)` and
   `ask web_search(*)` parse and fire through the hoisted gate; both tools stay refused in
   Plan? — **no**: search and read are reads. They are allowed in every mode, including Teach,
   and refused only by policy.
4. **Receipt + trace:** every search and read lands as a `tool:done` with the query / URL and in
   the run receipt's `tools` count, so a lesson's sources are auditable after the fact.
5. **Browser-driving (Browser Use / Stagehand) is deliberately NOT in this cut.** It is a
   different capability (act on a page, not read it), it needs a real browser process and a
   model in the loop per step, and nothing in teaching or building needs it before search does.
   Revisit when a concrete owner task needs a click.

### Why SearXNG first and not Firecrawl first

Firecrawl is the better *product* (search + full markdown in one call, and a category built for
papers); it is also a per-credit bill past 1K/month and a hosted dependency. Max's standing rule
is $0 by default, local compute is free, and the product must work with no key. SearXNG is the
only entry in the table that is unlimited, keyless and local. Firecrawl's self-hosted build is the
upgrade path if its categories prove decisive for teach mode — measure that on the 54-conversation
teach bench before paying for it.

## 4. Build order (one lane, ~2 days)

- **W1 — `web_search` on SearXNG.** `packages/analyzer/src/server/netSearch.ts` (JSON client,
  count cap, one `general` retry, in-process cache, SSRF rule); tool contract in `askTools.ts`
  (registry, `permissionSubjects` `query` arm, allowlist); `docs/how-to-verify.md` gets the one-line
  Docker command. Lock: a stubbed SearXNG returns 3 results → tool content lists them wrapped as
  untrusted; no instance → refusal names the fix; `deny web_search(*)` refuses and the breaker counts.
- **W2 — `web_read`.** Extraction + truncation contract + `.sequence/web/` cache; `fetch_url`
  stays as an alias for one release with a deprecation line in its evidence.
- **W3 — teach mode uses it.** The teach contract's "must-read-before-cite" rule extends to the web:
  a URL cited in a lesson must have been `web_read` this turn. The 54-conversation bench gets a
  "find a source" family.
- **W4 — provider ring (optional, keyed).** Firecrawl / Tavily / Exa behind `SEQUENCE_WEB_SEARCH_*`,
  keys handled exactly like the AI key (never in a receipt, never on the wire to the model).

## Sources

- Firecrawl, [Best Search Tools for AI Agents in 2026](https://www.firecrawl.dev/blog/best-search-tools-for-agents) · [Announcing /search](https://www.firecrawl.dev/blog/introducing-search-endpoint) · [firecrawl/firecrawl](https://github.com/firecrawl/firecrawl)
- [browser-use/browser-use](https://github.com/browser-use/browser-use) · Scrapfly, [Stagehand vs Browser Use](https://scrapfly.io/blog/posts/stagehand-vs-browser-use) · [Browserbase Stagehand](https://www.browserbase.com/stagehand)
- Stork, [Best Web Search APIs for AI 2026](https://www.stork.ai/blog/best-web-search-apis-for-ai-applications-2026) · itechguides, [7 free web search APIs compared](https://www.itechguides.com/7-free-web-search-apis-for-ai-agents-free-tiers-compared/)
- [OpenClaw — SearXNG search](https://docs.openclaw.ai/tools/searxng-search) · [Hermes — Web Search & Extract](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-search)
- dev.to, [Self-hosting SearXNG for free LLM/RAG web results](https://dev.to/greatsage_sh/skip-the-search-api-bill-self-hosting-searxng-for-private-search-and-free-llmrag-web-results-p23)
