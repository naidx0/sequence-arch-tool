# C2.1 — Browser surface Done when (define before building)

**Status:** landed · **Program:** mega-plan §5 Phase C · **Item:** C2.1  
**Rule:** tool+panel over fake Chrome; C2.4 security review before outbound fetch. Shipped in C2.5.

Cross-links: [`phase-d-public-beta-gate.md`](phase-d-public-beta-gate.md) D4, `packages/web2/src/app/workspaceViews.ts` (browser chrome pill), [`c2-browser-security-review.md`](c2-browser-security-review.md).

## Owner-seat Done when (binding shape)

1. **One clear product:** allowlisted browse tool (fetch/read URL under policy) **plus** a panel that shows the measured response — not an embedded Chromium pretending to be a full browser. **Met:** `fetch_url` + `BrowserPane` + `POST /api/net-fetch`.
2. **Honest chrome:** Browser pill is a workspace tab when shipped; no Settings CTA claiming browse is ready while `UNSHIPPED` blocks it. **Met:** `UNSHIPPED` is empty; browser is in `WORKSPACE_PILLS`.
3. **Security first:** C2.4 review before any outbound net browse (SSRF, redirect, content-type, size caps, no silent cookie jar). **Met:** `c2-browser-security-review.md` + `live-research.test.ts` locks.
4. **Grounded, not guessed:** every panel row cites tool evidence (URL, status, truncated body); no invented page title or DOM. **Met:** `BrowserPane` shows measured fetch only.
5. **MCP depth:** Settings can list/add MCP servers that already work in the engine (C2.2) without inventing a second browse stack. **Met:** C2.2 MCP editor.

## Explicit non-goals (this phase)

- Full Chromium / Playwright-inside-app as the default Browser surface.
- Ambient unrestricted fetch from chat without allowlist + size/time caps.
- Claiming “Browser ready” in D4 while `browser` remains in `UNSHIPPED`.

## Exit checklist

- [x] Owner confirms tool+panel over fake Chrome (C2.5 landed on mega branch).
- [x] C2.4 security note filed before implementation PR.
- [x] C2.5 shipped after Done when rows above evidenced.
