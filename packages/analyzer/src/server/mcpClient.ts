/**
 * MCP consume — allowlisted external stdio MCP tools (Wave 5).
 *
 * Sequence can CONSUME external MCP servers (the inverse of `@sequence/mcp`,
 * which EXPORTS Sequence's own tools). The allowlist is the on-disk config:
 * `.sequence/mcp.json` (repo-scoped) and/or `SEQUENCE_MCP_CONFIG` (env, same
 * JSON shape). Only servers named in the merged config can be listed or
 * called — an unknown server name is refused, never spawned.
 *
 * The transport is a minimal stdio JSON-RPC 2.0 client (newline-delimited
 * messages), so this module does NOT depend on `@modelcontextprotocol/sdk` —
 * the analyzer stays lean. It speaks just enough of the MCP protocol to:
 *   1. `initialize` (handshake) + send `notifications/initialized`,
 *   2. `tools/list` → tool names + descriptions + input schemas,
 *   3. `tools/call` { name, arguments } → content / isError.
 *
 * GROUNDING: this module NEVER invents graph topology. It only forwards a
 * configured server's declared tools and a caller's tool result. The Index
 * Tools section renders the configured SERVER NAMES (the allowlist), not
 * fabricated scan edges.
 *
 * Local-first: no network, no key. The configured servers are spawned as
 * child processes with the user's environment (plus per-server `env`); a
 * per-call timeout guards a hung server. Each operation spawns, handshakes,
 * runs, and tears the child down — no long-lived sessions are held by the
 * analyzer process.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SEQUENCE_DIR } from './store.js';

/** One configured stdio MCP server. `command` + `args` + optional `env`. */
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Per-server override of the call timeout (ms). Default 30000. */
  timeoutMs?: number;
}

/** The merged allowlist: server name → config. */
export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

/** A tool declared by a configured server (from `tools/list`). */
export interface McpToolInfo {
  /** The allowlisted server name that declared this tool. */
  server: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** Result of listing tools across every configured server. */
export interface ListMcpToolsResult {
  tools: McpToolInfo[];
  /** One entry per server that failed to list (never thrown — partial success). */
  errors: string[];
}

/** Result of one tool call. `isError` mirrors the MCP `isError` flag. */
export interface McpCallResult {
  server: string;
  tool: string;
  content?: unknown;
  isError?: boolean;
}

/** Thrown when a caller names a server that is not in the merged allowlist. */
export class UnknownMcpServerError extends Error {
  constructor(server: string) {
    super(`unknown MCP server "${server}" — not in allowlist`);
    this.name = 'UnknownMcpServerError';
  }
}

/** Thrown when a configured server fails to start, handshake, or respond. */
export class McpTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpTransportError';
  }
}

/** The config filename under `.sequence/`. */
export const MCP_FILE = 'mcp.json';
/** Env override: a JSON string of the same `{ servers }` shape. */
export const MCP_ENV = 'SEQUENCE_MCP_CONFIG';
/** Default per-call timeout (ms). */
export const DEFAULT_CALL_TIMEOUT_MS = 30_000;
/** Default handshake timeout (ms). */
export const DEFAULT_INIT_TIMEOUT_MS = 15_000;

/**
 * Load the merged MCP allowlist. The repo-scoped `.sequence/mcp.json` is
 * authoritative; `SEQUENCE_MCP_CONFIG` (env, same JSON shape) supplements
 * servers NOT already named in the file. Returns `{ servers: {} }` when
 * nothing is configured (never throws — a missing/unreadable file is an empty
 * allowlist, so the consume path degrades to "no tools" cleanly).
 */
export function loadMcpConfig(repoRoot: string | null): McpConfig {
  const servers: Record<string, McpServerConfig> = {};

  // Env first (lower precedence — file overrides per server name).
  const envRaw = process.env[MCP_ENV];
  if (envRaw && envRaw.trim().length > 0) {
    mergeServers(servers, safeParseConfig(envRaw, 'env'));
  }

  // File is authoritative per server name.
  if (repoRoot) {
    const file = path.join(repoRoot, SEQUENCE_DIR, MCP_FILE);
    let raw: string | undefined;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      raw = undefined;
    }
    if (raw !== undefined) mergeServers(servers, safeParseConfig(raw, file));
  }

  return { servers };
}

function mergeServers(
  into: Record<string, McpServerConfig>,
  from: McpConfig | undefined,
): void {
  if (!from || typeof from.servers !== 'object' || from.servers === null) return;
  for (const [name, cfg] of Object.entries(from.servers)) {
    if (!isServerConfig(cfg)) continue;
    // File (later) wins per name: only set when not already present would let
    // env win; we want file to win, so always overwrite when the file pass
    // supplies it. The env pass runs first, the file pass overwrites.
    into[name] = { ...cfg };
  }
}

function safeParseConfig(raw: string, label: string): McpConfig | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'servers' in parsed) {
      return parsed as McpConfig;
    }
    return undefined;
  } catch (e) {
    // A malformed config is treated as empty (never throws); the consume path
    // just yields no tools for that source.
    process.stderr.write(`sequence: mcp config "${label}" unparseable: ${(e as Error).message}\n`);
    return undefined;
  }
}

function isServerConfig(v: unknown): v is McpServerConfig {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.command !== 'string' || o.command.length === 0) return false;
  if (o.args !== undefined && !Array.isArray(o.args)) return false;
  if (o.args !== undefined && !(o.args as unknown[]).every((a) => typeof a === 'string')) return false;
  if (o.env !== undefined && (typeof o.env !== 'object' || o.env === null)) return false;
  if (o.timeoutMs !== undefined && typeof o.timeoutMs !== 'number') return false;
  return true;
}

/** Absolute path to repo-scoped `.sequence/mcp.json`. */
export function mcpConfigFilePath(repoRoot: string): string {
  return path.join(repoRoot, SEQUENCE_DIR, MCP_FILE);
}

export interface ParseMcpConfigResult {
  config: McpConfig;
  warnings: string[];
}

/**
 * Parse on-disk MCP config text for Settings GET/PUT. Invalid entries are
 * skipped with warnings; fatal JSON/shape errors return empty servers + warning.
 */
export function parseMcpConfigDocument(raw: string, label: string): ParseMcpConfigResult {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      config: { servers: {} },
      warnings: [`${label}: not valid JSON — ${(e as Error).message}`],
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { config: { servers: {} }, warnings: [`${label}: expected a JSON object`] };
  }
  const serversRaw = (parsed as Record<string, unknown>).servers;
  if (serversRaw === undefined) {
    return { config: { servers: {} }, warnings: [`${label}: missing "servers" object`] };
  }
  if (typeof serversRaw !== 'object' || serversRaw === null || Array.isArray(serversRaw)) {
    return { config: { servers: {} }, warnings: [`${label}: "servers" must be an object`] };
  }
  const servers: Record<string, McpServerConfig> = {};
  for (const [name, cfg] of Object.entries(serversRaw)) {
    if (!isServerConfig(cfg)) {
      warnings.push(`${label}: skipped invalid server "${name}"`);
      continue;
    }
    servers[name] = { ...cfg };
  }
  return { config: { servers }, warnings };
}

/** Canonical serialized text for `.sequence/mcp.json`. */
export function serializeMcpConfig(config: McpConfig): string {
  return `${JSON.stringify({ servers: config.servers }, null, 2)}\n`;
}

/** Load repo file only (not env merge) — for Settings editor. */
export function loadMcpConfigFromFile(repoRoot: string): {
  exists: boolean;
  config: McpConfig;
  warnings: string[];
} {
  const file = mcpConfigFilePath(repoRoot);
  let raw: string | undefined;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { exists: false, config: { servers: {} }, warnings: [] };
  }
  const { config, warnings } = parseMcpConfigDocument(raw, MCP_FILE);
  return { exists: true, config, warnings };
}

/** Write repo-scoped MCP config (Settings PUT). */
export function writeMcpConfigDocument(repoRoot: string, config: McpConfig): void {
  const dir = path.join(repoRoot, SEQUENCE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(mcpConfigFilePath(repoRoot), serializeMcpConfig(config), 'utf8');
}

/**
 * List every tool declared by every configured server. Spawns each server,
 * handshakes, calls `tools/list`, and tears it down. A server that fails to
 * start or respond is reported in `errors` (never thrown — the other servers
 * still list). Order is deterministic: servers in sorted name order, tools in
 * the order the server declared them.
 */
export async function listMcpTools(repoRoot: string | null): Promise<ListMcpToolsResult> {
  const { servers } = loadMcpConfig(repoRoot);
  const names = Object.keys(servers).sort();
  const tools: McpToolInfo[] = [];
  const errors: string[] = [];
  for (const name of names) {
    try {
      const client = await connectServer(name, servers[name]);
      try {
        const listed = await client.listTools();
        for (const t of listed) tools.push({ server: name, ...t });
      } finally {
        client.dispose();
      }
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  }
  return { tools, errors };
}

/**
 * Call one tool on one configured server. Refuses an unknown server name
 * (throws {@link UnknownMcpServerError}); the route translates that to a 4xx.
 * Spawns, handshakes, calls `tools/call`, and tears down. `args` defaults to
 * `{}` when omitted (MCP requires an arguments object).
 */
export async function callMcpTool(
  repoRoot: string | null,
  server: string,
  tool: string,
  args?: unknown,
): Promise<McpCallResult> {
  const { servers } = loadMcpConfig(repoRoot);
  const cfg = servers[server];
  if (!cfg) throw new UnknownMcpServerError(server);
  if (typeof tool !== 'string' || tool.length === 0) {
    throw new McpTransportError('tool name is required');
  }
  const callArgs = args === undefined ? {} : args;
  const client = await connectServer(server, cfg);
  try {
    const result = await client.callTool(tool, callArgs, cfg.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS);
    return { server, tool, content: result.content, isError: result.isError };
  } finally {
    client.dispose();
  }
}

/* --------------------------------------------------------------- transport -- */

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}
interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** A minimal stdio JSON-RPC 2.0 client for one MCP server. */
class StdioMcpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = '';
  private disposed = false;
  private stderrText = '';

  constructor(
    private readonly name: string,
    cfg: McpServerConfig,
  ) {
    const env = { ...process.env, ...(cfg.env ?? {}) };
    this.proc = spawn(cfg.command, cfg.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      windowsHide: true,
    });
    this.proc.stdout?.setEncoding('utf8');
    this.proc.stdout?.on('data', (chunk: string) => this.onStdout(chunk));
    this.proc.stderr?.setEncoding('utf8');
    this.proc.stderr?.on('data', (chunk: string) => {
      this.stderrText += chunk;
      // Cap stderr capture so a chatty server can't grow memory unbounded.
      if (this.stderrText.length > 4096) this.stderrText = this.stderrText.slice(-4096);
    });
    this.proc.on('error', (e) => this.failAll(new McpTransportError(`spawn failed: ${e.message}`)));
    this.proc.on('exit', (code, signal) => {
      if (!this.disposed) {
        this.failAll(
          new McpTransportError(
            `server "${this.name}" exited (code=${code ?? '?'} signal=${signal ?? '?'})` +
              (this.stderrText ? `\nstderr: ${this.stderrText.trim()}` : ''),
          ),
        );
      }
    });
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line.length === 0) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line) as JsonRpcResponse;
      } catch {
        continue; // ignore malformed lines — never crash the client
      }
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const entry = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) {
          entry.reject(new McpTransportError(`${msg.error.message} (code ${msg.error.code})`));
        } else {
          entry.resolve(msg.result);
        }
      }
    }
  }

  private failAll(e: Error): void {
    for (const entry of this.pending.values()) entry.reject(e);
    this.pending.clear();
  }

  private send(msg: JsonRpcRequest | JsonRpcNotification): void {
    if (!this.proc || !this.proc.stdin) throw new McpTransportError('server not connected');
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new McpTransportError(`"${method}" timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.send({ jsonrpc: '2.0', id, method, params });
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e as Error);
      }
    });
  }

  /** Handshake with the server (initialize + initialized notification). */
  async initialize(timeoutMs = DEFAULT_INIT_TIMEOUT_MS): Promise<void> {
    const result = (await this.request(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: '@sequence/analyzer', version: '0.1.0' },
      },
      timeoutMs,
    )) as { serverInfo?: unknown } | undefined;
    // The server returns its info; we don't need it. Send the initialized
    // notification to complete the handshake (per the MCP spec).
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    void result;
  }

  /** `tools/list` → the server's declared tools (name + description + schema). */
  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    const result = (await this.request('tools/list', undefined, DEFAULT_CALL_TIMEOUT_MS)) as
      | { tools?: unknown }
      | undefined;
    const tools = result?.tools;
    if (!Array.isArray(tools)) return [];
    return tools
      .filter((t): t is { name: string; description?: string; inputSchema?: unknown } =>
        !!t && typeof t === 'object' && typeof (t as { name?: unknown }).name === 'string',
      )
      .map((t) => ({
        name: t.name,
        description: typeof t.description === 'string' ? t.description : undefined,
        inputSchema: t.inputSchema,
      }));
  }

  /** `tools/call` { name, arguments } → content / isError. */
  async callTool(
    name: string,
    args: unknown,
    timeoutMs: number,
  ): Promise<{ content?: unknown; isError?: boolean }> {
    const result = (await this.request(
      'tools/call',
      { name, arguments: args },
      timeoutMs,
    )) as { content?: unknown; isError?: boolean } | undefined;
    return { content: result?.content, isError: result?.isError === true ? true : undefined };
  }

  /** Tear down the child process. Safe to call multiple times. */
  dispose(): void {
    this.disposed = true;
    this.failAll(new McpTransportError('client disposed'));
    const proc = this.proc;
    this.proc = null;
    if (!proc) return;
    try {
      proc.stdin?.end();
    } catch {
      /* ignore */
    }
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }
}

/** Spawn + handshake one server, returning a ready client. */
async function connectServer(name: string, cfg: McpServerConfig): Promise<StdioMcpClient> {
  const client = new StdioMcpClient(name, cfg);
  try {
    await client.initialize(cfg.timeoutMs ?? DEFAULT_INIT_TIMEOUT_MS);
    return client;
  } catch (e) {
    client.dispose();
    throw e instanceof Error ? e : new McpTransportError(String(e));
  }
}
