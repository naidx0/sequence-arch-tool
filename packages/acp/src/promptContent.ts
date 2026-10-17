/* ══════════════════════════════════════════════════════════════════════════
   WHAT A SESSION AND A PROMPT CARRY BEYOND TEXT (S2a)
   packages/acp/src/promptContent.ts

   THE BOARD'S MCP SERVER. Sequence's own server (packages/mcp) goes into
   every session the agent opens, without touching the user's config:
     ACP     session/new, session/resume, session/load `mcpServers`: one stdio
             entry named "sequence" (McpServerStdio { name, command, args,
             env: EnvVariable[] }).
     Codex   a per-thread config override on thread/start and thread/resume
             (ThreadStartParams.config, a map of dotted config keys):
             `mcp_servers.sequence.command|args|env`. ~/.codex/config.toml is
             never written.

   ATTACHMENTS, as the agent can take them:
     image    ACP: an image block (base64) only when initialize reported
              promptCapabilities.image, else a resource_link to the file.
              Codex: a localImage item pointing at the file (never base64 in
              the JSON). Sequence caps the long edge at 1568 px before this.
     file     ACP: resource_link with the absolute file:// uri. Codex: a
              mention item { name, path }.
     context  a mentioned board node: its map slice. ACP: an embedded text
              resource when promptCapabilities.embeddedContext, else a
              resource_link plus the slice inline as text. Codex: the slice
              inline as text.

   Pure, apart from reading an image's bytes (injected).
   ══════════════════════════════════════════════════════════════════════════ */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** A stdio MCP server to put into the agent's session. */
export interface AgentMcpServer {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  /**
   * Claude only: tool names (`mcp__<server>__<tool>`) the session may call without asking. Not sent to the agent as part of the
   * server; it goes in the session's `allowedTools`. Absent means every call asks, as for any other server.
   */
  allowTools?: string[];
}

export type PromptAttachment =
  | { kind: 'image'; path: string; mimeType: string }
  | { kind: 'file'; path: string; name?: string }
  | { kind: 'context'; name: string; uri: string; text: string };

/** What initialize said the agent's prompts may carry. */
export interface PromptCaps {
  image: boolean;
  embeddedContext: boolean;
}

type Json = Record<string, unknown>;

export function acpMcpServers(servers: readonly AgentMcpServer[] | undefined): Json[] {
  return (servers ?? []).map((s) => ({
    name: s.name,
    command: s.command,
    args: [...s.args],
    env: Object.entries(s.env ?? {}).map(([name, value]) => ({ name, value })),
  }));
}

/** Codex's per-thread override: `mcp_servers.<name>.command|args|env`, dotted keys as `-c` takes them. */
export function codexMcpConfig(servers: readonly AgentMcpServer[] | undefined): Json | null {
  if (!servers?.length) return null;
  const config: Json = {};
  for (const s of servers) {
    config[`mcp_servers.${s.name}.command`] = s.command;
    config[`mcp_servers.${s.name}.args`] = [...s.args];
    if (s.env && Object.keys(s.env).length) config[`mcp_servers.${s.name}.env`] = { ...s.env };
  }
  return config;
}

const fileUri = (p: string): string => pathToFileURL(path.resolve(p)).href;

/** The ACP prompt: the text, then one block per attachment, as the agent can take it. */
export function acpPromptBlocks(text: string, attachments: readonly PromptAttachment[] | undefined, caps: PromptCaps, readBase64: (p: string) => string): Json[] {
  const blocks: Json[] = [{ type: 'text', text }];
  for (const a of attachments ?? []) {
    if (a.kind === 'image') {
      blocks.push(
        caps.image
          ? { type: 'image', mimeType: a.mimeType, data: readBase64(a.path), uri: fileUri(a.path) }
          : { type: 'resource_link', uri: fileUri(a.path), name: path.basename(a.path), mimeType: a.mimeType },
      );
    } else if (a.kind === 'file') {
      blocks.push({ type: 'resource_link', uri: fileUri(a.path), name: a.name ?? path.basename(a.path) });
    } else if (caps.embeddedContext) {
      blocks.push({ type: 'resource', resource: { uri: a.uri, mimeType: 'text/markdown', text: a.text } });
    } else {
      blocks.push({ type: 'resource_link', uri: a.uri, name: a.name, mimeType: 'text/markdown' });
      blocks.push({ type: 'text', text: a.text });
    }
  }
  return blocks;
}

/** Codex's turn/start input: the text, images as localImage, files as mentions, node slices inline. */
export function codexInputItems(text: string, attachments: readonly PromptAttachment[] | undefined): Json[] {
  const items: Json[] = [{ type: 'text', text, text_elements: [] }];
  for (const a of attachments ?? []) {
    if (a.kind === 'image') items.push({ type: 'localImage', path: path.resolve(a.path) });
    else if (a.kind === 'file') items.push({ type: 'mention', name: a.name ?? path.basename(a.path), path: path.resolve(a.path) });
    else items.push({ type: 'text', text: a.text, text_elements: [] });
  }
  return items;
}
