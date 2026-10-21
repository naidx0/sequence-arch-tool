# Board tools: exact runtime handoff

For the runtime owner. No ACP/analyzer/server source was edited in this lane. Inspected the runtime source at parent integration `4df3d864be9f91e6a98642545411ea3768ad0dd7`; rebase the request onto the current parent head.

## Default catalog and registration

The MCP core catalog now contains exactly:

`map`, `who_calls`, `impact`, `architecture_changed`, `list_boards`, `create_board`, `draw`.

Five are read operations; **create_board and draw write board data**, including draw's update/remove operations. The listing is 2,013 tokens versus 1,197 for four reads and 4,875 for all 19 (ceil(serialized JSON chars / 4), default session repo schemas, SDK 1.29.0). The test budget is 2,200. Drawing is authorized by the owner in this session; that authority is scoped to board annotations, not arbitrary Sequence tools or MCP questions.

`packages/analyzer/src/server/sequenceMcp.ts` already sets `SEQUENCE_MCP_TOOLS=core` when `allTools` is false. The three repoServer call sites at parent 4df3d864 (2399, 3003, 7913) already use that helper. **No switch to all tools is required.** Update the stale four/read-only comments in sequenceMcp.ts when integrating. Rebuild the packaged `sequence-mcp.cjs` from the new source; a stale desktop bundle would still list four tools.

## Required ACP patch request

1. `packages/acp/src/client.ts`, `claudeOptions()` (parent line 521): replace the server wildcard with this exact allowlist:

```ts
const board = this.config.mcpServers?.some(s => s.name === 'sequence')
  ? { allowedTools: [
      'mcp__sequence__map', 'mcp__sequence__who_calls',
      'mcp__sequence__impact', 'mcp__sequence__architecture_changed',
      'mcp__sequence__list_boards', 'mcp__sequence__create_board',
      'mcp__sequence__draw',
    ] }
  : undefined;
```

Replace “they only read” in the comment with “five architecture/board reads and two owner-authorized board annotation writes.” Do not grant export_diagram, whiteboard's outPath, design_suggest, future tools or arbitrary server names through a wildcard. This is authorization for the requested drawings, not a reason to alter the access mode or file/command permissions.

2. `packages/acp/src/codexAppServer.ts`, `onServerRequest()` (parent 692): replace unconditional acceptance based on `serverName === 'sequence'`. The existing synthetic fixture asks before `item/started`, so there may be no correlated MCP item yet. A request containing only `serverName` cannot establish which tool it would authorize.

Use a small local helper for the **known generated, empty-form tool consent shape** below. This is a precise recognition of the existing replay specimen; it is not a general natural-language authorization parser. Verify it against the provider's current protocol before treating different messages as equivalent. Unknown shapes must remain non-auto-approved and use the existing permission/question surface when it can represent them; otherwise return a bounded decline, never accept `{}` as answers to required form fields.

```ts
const BOARD_CONSENT_TOOLS = new Set([
  'map', 'who_calls', 'impact', 'architecture_changed',
  'list_boards', 'create_board', 'draw',
]);

function boardToolConsent(p: Json): string | null {
  if (p.serverName !== 'sequence' || p.mode !== 'form') return null;
  const schema = p.requestedSchema as Json | undefined;
  if (!schema || schema.type !== 'object') return null;
  if (Object.keys(schema).some(key => !['type', 'properties', 'required'].includes(key))) return null;
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)
      || Object.keys(properties).length !== 0) return null;
  if (schema.required !== undefined
      && (!Array.isArray(schema.required) || schema.required.length !== 0)) return null;
  const match = typeof p.message === 'string'
    ? /^Allow the sequence MCP server to run tool "([a-z_]+)"\?$/.exec(p.message)
    : null;
  return match && BOARD_CONSENT_TOOLS.has(match[1]!) ? match[1]! : null;
}
```

At the existing elicitation branch use `configuredSequence && boardToolConsent(p) !== null` as the bounded auto-approval condition **under this session's existing authorization for board drawings**. If runtime has a separate per-session board-write authority flag, require it specifically for create_board/draw; do not infer it from readOnlyHint, access mode, or the server name. Keep ordinary reads automatic. Do not make elicitation acceptance a server-wide policy. No claim here that arbitrary form/URL elicitation is implemented.

3. Targeted replay locks in `packages/acp/src/test/s2a-adapter.test.ts` and its own replay fixture: keep map's positive control; add configured sequence draw/create_board consent in an authorized drawing session; assert the two calls are reported as writes (`readOnlyHint:false` must not become a read row). Negative controls: same server with export_diagram, unrecognized tool, missing tool name, nonempty/required form, URL mode, and an unrelated server. Keep file/command approval tests unchanged. Replace the fixture/header claim that all Sequence tools only read. Parent chooses and gates the unsupported-shape permission/decline path; this lane does not guess a broader policy.

The default MCP discovery/storage gate can pass independently of ACP consent. Do not report end-to-end provider drawing complete until these runtime locks and the packaged-bundle listing agree.
