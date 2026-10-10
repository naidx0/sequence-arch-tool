# C2.3 — Plugin manifest v0 (read-only tools first)

**Status:** schema + loader + ask `call_plugin` landed  
**Code:** `packages/analyzer/src/server/pluginManifest.ts`, `askTools.ts` (`call_plugin`)  
**On disk:** `<repo>/.sequence/plugins.json` (optional)

## Done when

1. A validated **v0** JSON shape exists: `version: 0`, `plugins[]` with `id`, `mode: "readonly"`, `tools[]`.
2. Missing file → empty plugin list (success). Invalid JSON / non-readonly mode → honest error (no invented tools).
3. Settings lists plugins via `GET /api/plugins` with `askWired: true`.
4. Ask dispatches declared tools via **`call_plugin`** `{ plugin, tool, args? }` behind the same permission breaker as MCP (`plugin` subject kind).
5. Closed builtins only (`ping` today); declared tools without a handler refuse honestly — never fabricate output.

## Explicitly out of v0

- Mutating / shell plugin modes
- Settings UI to **edit** plugins (same honesty bar as MCP stub — C2.2)
- Arbitrary third-party plugin runtimes / dynamic loaders

## Next (optional)

More readonly builtins, or a sandboxed loader — still no mutating modes until a later plan row.
