/**
 * REA's tools, and which of them the `@reverse` profile may use.
 *
 * REA's MCP server advertises 207 tools and marks almost none of them read-only (5 carry `readOnlyHint`), because every
 * inspection records Evidence in REA's own session. What it does declare, per tool, is its effects (binary_session's
 * tool_availability), and that is what this derives the read-only set from, never from a hand-written list:
 *
 *   - a tool that mutates the target, the network, the UI, a device, runs the target's code, or can discard data is out;
 *   - a tool that only writes REA's scratch space or starts a helper process (a decompiler, an archive reader) is in
 *     only if it is on SCRATCH_ONLY, the reviewed list of static analyses, because the effect flags cannot tell a
 *     decompiler's temp directory from an export into the person's folder;
 *   - NEVER lists the tools that write where the person points (extract, export, recover) or open a debugger, and wins.
 *
 * The test derives the set from the captured catalog and fails when this file and the catalog disagree.
 */
import { REA_CATALOG } from './reaCatalog.js';

export type ReaEffect =
  | 'mutatesTarget'
  | 'mutatesSession'
  | 'writesFilesystem'
  | 'launchesProcess'
  | 'accessesNetwork'
  | 'changesUiState'
  | 'mayDiscardData'
  | 'executesForeignCode'
  | 'mutatesDevice'
  | 'idempotent';

export interface ReaToolInfo {
  name: string;
  surface: string;
  /** The input fields the tool requires (from its input schema). */
  required: readonly string[];
  effects: readonly ReaEffect[];
}

/** Effects that make a tool unfit for a read-only role. */
export const DENY_EFFECTS: readonly ReaEffect[] = ['mutatesTarget', 'accessesNetwork', 'changesUiState', 'mayDiscardData', 'executesForeignCode', 'mutatesDevice'];

/** Static analyses that write only REA's own scratch space or start a helper (decompiler, reader) on a file. Reviewed by name. */
export const SCRATCH_ONLY: readonly string[] = [
  'analyze_javascript_application',
  'binary_session',
  'open_binary',
  'inspect_artifact',
  'inspect_binary_layout',
  'inspect_recorded_crash',
  'inspect_wasm_artifact',
  'inspect_evm_interface',
  'inspect_sqlite_database',
  'inspect_firmware_regions',
  'inspect_web_network_capture',
  'inspect_pcap_client',
  'inspect_pcap_capture',
  'inspect_packet_capture',
  'inspect_packet_fields',
  'decode_signal_recording',
  'inspect_signal_decoders',
  'inspect_android_package',
  'search_android_classes',
  'inspect_android_class',
  'inspect_android_method',
  'trace_android_references',
  'inspect_apktool_client',
  'identify_flutter_build',
  'inspect_dart_aot',
  'inspect_with_objdump',
  'inspect_macho',
  'inspect_signature',
  'inspect_plist',
  'inspect_asset_catalog',
  'list_architectures',
  'demangle_swift',
];

/** Closing a REA session discards its working state, which is the point of closing it; REA never touches the target. */
export const SESSION_EXCEPTIONS: readonly string[] = ['close_binary'];

/** Never in a read-only role: they write where the person points, drive a debugger or a device, or reach a live page. */
export const NEVER: readonly string[] = [
  'extract_artifact',
  'extract_firmware',
  'export_web_scripts',
  'export_evidence_bundle',
  'recover_javascript_sources',
  'decode_android_resources',
  'observe_native_ui',
  'start_gdb_session',
  'trace_web_source_location',
  'inspect_adb_client',
];

/** Whether REA's declared effects alone clear a tool for a read-only role (before the scratch list and exceptions). */
export function clearedByEffects(effects: readonly ReaEffect[]): boolean {
  if (effects.some((e) => DENY_EFFECTS.includes(e))) return false;
  return !effects.includes('writesFilesystem') && !effects.includes('launchesProcess');
}

/** The read-only tools in a catalog, sorted. */
export function readOnlyToolsOf(catalog: readonly ReaToolInfo[]): string[] {
  return catalog
    .filter((t) => {
      if (NEVER.includes(t.name)) return false;
      if (SESSION_EXCEPTIONS.includes(t.name)) return true;
      if (clearedByEffects(t.effects)) return true;
      return SCRATCH_ONLY.includes(t.name) && !t.effects.some((e) => DENY_EFFECTS.includes(e));
    })
    .map((t) => t.name)
    .sort();
}

/** What the `@reverse` profile and the agent's pre-approval use: the read-only tools of the pinned REA catalog. */
export const REA_READ_ONLY_TOOLS: readonly string[] = readOnlyToolsOf(REA_CATALOG);

/** The MCP server name REA is registered under, in `.sequence/mcp.json` and in an agent's session. */
export const REA_SERVER_NAME = 'rea';

/** The names an agent sees for REA's read-only tools: `mcp__rea__<tool>`. */
export const reaAgentToolNames = (tools: readonly string[] = REA_READ_ONLY_TOOLS): string[] => tools.map((t) => `mcp__${REA_SERVER_NAME}__${t}`);
