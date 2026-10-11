# C2.4 — Browser / net-browse security review (before any outbound fetch)

**Status:** landed · **Program:** mega-plan §5 Phase C · **Item:** C2.4  
**Rule:** no Browser unship (C2.5) and no net browse tool until this review is closed. Prefer tool+panel ([`c2-browser-done-when.md`](c2-browser-done-when.md)).

## Threat model (stdio MCP is out of scope here)

Outbound HTTP/HTTPS from the ask/browse path on behalf of a user question.

| Risk | Mitigation required before ship |
|------|----------------------------------|
| SSRF to loopback / link-local / cloud metadata | Deny private IP ranges + DNS rebinding checks after resolve; no raw IP allow by default |
| Open redirect / scheme abuse | HTTPS-only allowlist (optional http for localhost labs behind a flag); reject `file:`, `data:`, `javascript:` |
| Oversized response / zip bomb | Hard byte + time caps; streaming truncate; no decompress of attacker-controlled archives into memory unbounded |
| Credential leakage | No ambient cookie jar; no forwarding of user cookies; strip `Authorization` from redirects off-origin |
| Prompt injection via page body | Feed model only capped, neutralized text (same untrusted wrappers as file tools); never claim DOM truth without evidence |
| Silent exfil via MCP+browse combo | Browse tool must be permission-gated like `run_command`; deny streaks apply |

## Non-goals until owner rules

- Full Chromium embedded browser
- Arbitrary CORS bypass from web2 origin
- Storing third-party session cookies in `.sequence/`

## Exit checklist

- [x] Threat rows above have named code owners (analyzer route + web2 panel)
- [x] Locking tests for SSRF deny + size/time caps (`live-research.test.ts`, `netFetchEndpoint.test.ts`, `ask-tool-loop` fetch_url)
- [x] C2.1 Done when still met (tool+panel, not fake Chrome)
- [x] C2.5 unship only after this file’s exit rows are evidenced
