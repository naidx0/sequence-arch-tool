# REA (morluto/rea, "Reverse Engineer Anything")

Researched 2026-10-16/17 for the components program (slice D of `docs/plans/components-plan.md`). Everything below was read in the
source or observed in a sealed run; what was not verified is listed at the end.

**Pinned commit:** `0a51b246c632a36b24c121282aeb51fda1ddb461` (2026-10-17 08:53 +0800, "fix(firmware): preserve snapshot input failures and descriptor ownership"), package `rea-agents` **6.5.0**, licence **MIT**
(copyright 2026 morluto), TypeScript, <https://github.com/morluto/rea>.

## What it is

One package that is both a CLI (`rea`, `scripts/rea.mjs`, built on `incur`) and a stdio MCP server (`rea mcp`). It inspects shipped
software from the artifact, without the source: native binaries (through Hopper, Ghidra or IDA that you install), JavaScript and
Electron apps (ASAR or an extracted folder, statically), .NET assemblies, Android APKs (through JADX), firmware, WASM, EVM bytecode,
SQLite files, packet captures, and live pages or Electron windows over a debugging port. Every answer is an Evidence record
(`evidence_id`, `subject`, `provider`, `normalized_result`, `confidence`, `authority`, `limitations`, `locations`) so a claim can be
traced to what produced it. It also ships a skill (`.agents/skills/reverse-engineer-anything`, 23.5 KB plus five reference files) that
tells an agent how to route and what to claim; `rea setup` installs that skill and writes the MCP registration into an agent's config.

## Code read before anything ran

| Item | Finding |
|---|---|
| `package.json` scripts | `prepare` runs `scripts/prepare.mjs`, which installs husky git hooks only when `src/` and husky exist (`HUSKY=0` skips). No `preinstall` or `postinstall`. `prepack`, `prepublishOnly` are publish-time. `build` is turbo; the build that matters is `compile`. |
| `compile` | `clean-build-output.mjs` (removes `dist/`), `tsc -p tsconfig.build.json`, `record-catalog-digests.mjs` (imports the compiled catalog, writes `dist/recordedCatalogDigests.js`), `bundle-runtime.mjs` (rolldown, keeps dependencies external). No network, no spawn, no writes outside `dist/`. Read in full. |
| Install scripts in the lockfile | Only `esbuild` (dev), `frida` (optional, native; downloads a prebuilt devkit), `fsevents` (macOS, optional). `npm ci --ignore-scripts` runs none of them. All 750 lockfile entries resolve from `registry.npmjs.org`. |
| Network calls in `src/` | `HopperDownload.ts` (setup, only with approval, from hopperapp.com), `IdaMcpConnection.ts` (an IDA MCP endpoint you configure), `CdpConnection.ts` (WebSocket to a local browser or Electron debugging port), `WebSourceMapFetcher.ts` (source maps of a site you point it at), and `rea update` (shells out to `npm view`). No telemetry, analytics or error-reporting calls (grepped). |
| Binaries it shells out to | Hopper (`HOPPER_LAUNCHER_PATH`), Ghidra 12.1.x (`GHIDRA_INSTALL_DIR`, needs Java), IDA via an MCP registration (`REA_IDA_MCP_CONFIG`), Kuna (`REA_KUNA_COMMAND`), JADX and Java, apktool, ILSpy, Binwalk and Unblob, tshark and capinfos, sigrok-cli, WABT, mitmdump, pwntools and pwndbg (Python), gdb, rizin and Cutter, objdump, adb, Wakaru, Frida, Playwright's browsers, and on Linux a procps `ps`. None is bundled. |
| What `rea setup` writes | The agent client's MCP registration (for Claude Code `~/.claude.json`, with `.rea.backup` copies) and the skill into the client's skills folder (`~/.claude/skills/reverse-engineer-anything`). With `--install-hopper` it downloads Hopper and on Linux runs `pkexec apt-get`, `dnf` or `pacman` as root. Sequence runs none of this. |
| Submodules | `third_party/{binwalk,unblob,jadx-headless-mcp,ghidra-nativeaot,wakaru}` are git submodules, not initialised by a plain fetch. Not needed for the MCP server. |
| Windows | The Windows addon (`native/windows/build/rea-windows-x64.node` plus manifest) is built on Linux with MinGW and ships only in the npm package. A source checkout has no copy. REA's own README says to extract it from the matching `npm pack rea-agents@6.5.0`. |

An earlier review of the skill text (`docs/research/rea-security-review.md`, 6.4.0) found the same high-risk surface (unpinned `npx`,
`rea setup` writing global config, Hopper's root install, running the target); Sequence's `/reverse-engineer` skill and the managed
install below remove each of those.

## What I ran, sealed

Download only into `rea-src/`: `git clone https://github.com/morluto/rea` then `git rev-parse HEAD` = the pin above. Checkout 143 MB
(82 MB of it `.git`; a depth-1 fetch of the commit is a 12.8 MiB pack and a 61 MB tree).

Environment for every run: `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP` and the XDG folders pointed at an empty scratch
folder, `npm_config_cache` and `npm_config_userconfig` in scratch, `npm_config_ignore_scripts=true`, `HUSKY=0`. Nothing was installed
globally. After all runs the scratch home and appdata were still empty and `~/.claude` was never touched.

| Command | Exit | Result |
|---|---|---|
| `npm ci --prefix <clone> --ignore-scripts` | 0 | 540 packages (of 750 in the lockfile; the rest are other platforms), 14 s, 489 MB `node_modules`, npm cache 123 MB |
| `npm run compile --prefix <clone>` | 0 | `dist/` 28 MB, 14 s; two harmless rolldown `INEFFECTIVE_DYNAMIC_IMPORT` warnings |
| `npm prune --omit=dev --ignore-scripts` | 0 | removed 367 packages; `node_modules` 115 MB; the server and CLI still ran afterwards |
| `node scripts/rea.mjs --version` | 0 | `6.5.0` |
| `rea --help` | 0 | the full command list (one command per tool) |
| `rea setup --client claude_code --dry-run --json` | 0 | status `planned`; two actions, both inside the scratch home: add the MCP registration (`node <clone>/scripts/rea.mjs mcp`) and install the skill. Applied nothing. |
| `rea doctor --json` | 1 | not healthy, as expected: no Hopper, Ghidra, IDA or JADX, and no Windows native controls |
| `rea analyze-javascript-application <sample>.asar --json` and on the extracted folder | 1 | `capability_unavailable`: "REA Windows native controls are unavailable: Missing packaged Windows native file native/windows/build/manifest.json" |
| MCP: `initialize`, `tools/list`, `prompts/list`, then 97 `tools/call`s | 0 | server `rea` 6.5.0; **207 tools**, 6 prompts; see below |

The sample is a tiny Electron-shaped app written for this (`main.js` with an `ipcMain.handle('notes:search')`, a preload bridge, a renderer),
packed to `tiny-notes.asar` (2,979 bytes) with REA's own `@electron/asar`. No third-party binary was used.

### Tools

207 tools in 17 surfaces: official-proxy (Hopper, 41), native-provider (32), session (21), adb-provider (24), application (20), artifact-provider
(16), enhanced (14), browser-provider (12), android-provider (5), electron-provider (5), jeb-provider (4), managed-provider (3), and a few
with 2 each (firmware, pcap, flutter, apktool, runtime). Prompts: `investigate_feature`, `compare_application_versions`, `verify_reconstruction`,
`trace_crash`, `audit_residual_unknowns`, `prepare_bounded_process_capture`.

Inputs are JSON objects validated against each tool's schema; a call missing required fields answers `isError: true` with
`Input validation error: Invalid arguments for tool <name>: ...`. Results are one `text` content item holding JSON: `{"result": ...}` for session
tools (`open_binary` -> `{path, format, kind, sha256, architecture}`), a full Evidence record for analyses (`inspect_artifact` on the sample
returned `normalized_result.observations`, `hypotheses` ("may contain a recoverable JavaScript application graph", confidence low) and
`next_probes` (`analyze_javascript_application`)), and `{"error": {code, category, message, retryable, remediation, details}}` with
`isError: true` when something is unavailable.

What each returned in the sealed run (97 calls; 4 succeeded, 93 were `isError`, almost all of them input validation or "needs an open target"
because they were called with `{}` to learn their shape):

- `binary_session {}`: 74 KB: tool availability in 76 groups, each with its declared **effects**. On this machine 77 of 207 tools could run;
  the rest said `target_required` (72), `provider_unavailable` (27), `provider_missing` (21) or `unsupported_host` (10, macOS-only).
- `open_binary` and `inspect_artifact` on the ASAR: worked (they need no native control). `close_binary`: `{"result": null}`.
- `analyze_javascript_application` on the ASAR: `capability_unavailable` (the Windows native controls above). The error carries a
  `partial_observation` Evidence record for the artifact (sha256 `6dc20ad2...`), so the failure is itself evidence.
- `inspect_electron_fuses` on the ASAR: `unsupported_target` (it wants a Mach-O, ELF or PE).
- The other 90 static and session tools answered input validation naming the missing fields (for example `address`, `procedure`, `path`).

**The tools declare effects, not read-only.** Only 5 of 207 carry `readOnlyHint` (every inspection records Evidence in REA's session).
The effects vocabulary is `mutatesTarget`, `mutatesSession`, `writesFilesystem`, `launchesProcess`, `accessesNetwork`, `changesUiState`,
`mayDiscardData`, `executesForeignCode`, `mutatesDevice`, `idempotent`. Sequence derives the read-only set from these
(`packages/analyzer/src/components/reaTools.ts`): 128 of 207, with 79 left out (debuggers, Frida, browser and Electron scenarios, devices,
annotation, extraction and export).

## Licence

MIT for REA itself; the licence text is `LICENSE` in the repository and is shipped beside the built-in skill. REA's `licenses/` folder carries
the texts for what it redistributes in bridges (Apache-2.0, GPL-3.0 and LGPL-2.0 for the invoked tools, the GCC runtime exception, MinGW,
Node). It bundles none of Hopper, Ghidra or IDA (proprietary or separately licensed); Sequence installs none of them either.

## Risks

1. **Running unreviewed code.** REA is 143 MB of someone else's TypeScript plus 540 npm packages. Mitigations: one pinned commit (the fetched HEAD must
   equal it or nothing is installed), the lockfile only, no install script run, the single `compile` step read in full, and the server is not
   started until the person adds it. It is not sandboxed once running: an MCP server runs with the person's rights.
2. **Tools that run or change things.** 79 tools launch debuggers, Frida, browsers, Electron windows or processes, touch devices, write files where
   told, or change the analysis database. Only the 128 read-only tools are pre-approved for a chat agent and named in `@reverse`.
3. **Prompt injection through the target.** Strings, decompiled code and page text come from the artifact. The skill and the profile say so; this is a
   mitigation, not a guarantee.
4. **Network at runtime.** Only on request (web analysis, CDP, IDA, Hopper setup). The read-only set excludes every tool that declares
   `accessesNetwork`.
5. **Heavy optional engines.** Hopper, Ghidra (Java), IDA are the user's to install. The Settings row says so before the click.
6. **Windows.** A source build has no Windows native addon, so `analyze_javascript_application` and the other provider-backed tools report
   themselves unavailable. Archive listing works. **Decided (owner, 2026-10-17: "offer an off or a start and download required at the same time"):** the component's setup is Off (default, nothing
   downloaded) or Start, and Start does both downloads in one go. On Windows it takes the two native files (`native/windows/build/manifest.json`,
   `rea-windows-x64.node`) from the npm tarball: the registry's `dist.integrity` (sha512) is checked before the tarball is opened, the system
   `tar` lists it and any `../`, absolute or drive-lettered entry refuses the whole tarball, only the two named members are extracted, and their
   sha256 is recorded in the install manifest. No package script runs. Then `rea doctor --json` runs (sealed env) and the row says in plain words what works.
7. **Disk and time.** About 115 MB download, about 185 MB on disk (measured), about 40 s on a fast connection.

## How Sequence integrates it (off by default)

- **Install** (`packages/analyzer/src/components/reaInstall.ts`): Settings, MCP servers, **Add REA** shows the repository, commit, size, install
  folder and the exact commands; **Download and install** then runs, in `~/.sequence/components/rea/<commit>/` and with no admin rights:
  `git fetch --depth 1 origin <commit>` (checked out HEAD must equal the pin), `npm ci --ignore-scripts`, `npm run compile`,
  `npm prune --omit=dev --ignore-scripts`, `node scripts/rea.mjs --version` (must print the pinned version). Built in a `.partial-*` folder and renamed
  on success, so a failure leaves nothing that looks installed.
- **Registration:** the `rea` entry in the project's `.sequence/mcp.json` (`command` = the absolute `node`, `args` = `[<install>/scripts/rea.mjs, "mcp"]`).
  A `rea` entry the person wrote is never replaced or removed.
- **Chat agents:** when installed and added, the agent's session gets the `rea` server with only the 128 read-only tools pre-approved
  (`allowedTools: mcp__rea__<tool>`); everything else REA offers asks, and in Plan is refused.
- **Skill:** built-in `/reverse-engineer` (`packages/analyzer/builtin-skills/reverse-engineer`), Sequence's shortened adaptation with its own rules first.
- **Profile:** `@reverse`, read-only (the message is sent in Plan), instructions name exactly the read-only tools.
- **One-shot MCP calls** from Sequence itself (`/api/mcp/call`) spawn the server per call, so a stateful REA flow (`open_binary` then follow-ups) belongs
  in a chat agent's session, which keeps the server for the turn.

## Not verified

- A real `claude` or `codex` driving REA: tests never reach one. `allowedTools` pre-approval is unit-tested at the point it is sent
  (`session/new` `_meta.claudeCode.options`), not against a live agent.
- Real Hopper, Ghidra, IDA, JADX: none installed, so native and Android tool results are known only as "unavailable" with REA's stated reasons.
- (Done, not open) The Windows-native workaround was run for real, in a scratch user store: the tarball's sha512 matched the registry's `dist.integrity` (5.6 MB), the two files were
  taken, and `rea doctor --json` changed from "REA Windows native controls are unavailable" to no native complaint; `analyze-javascript-application` on a small Electron-shaped folder
  then ran instead of answering `capability_unavailable`. Hopper, Ghidra, IDA and JADX stay missing.
- (Done, not open) The install routine itself, `installRea`, was also run once against the real repository, in the sealed environment into a scratch user store:
  39 s, `ok`, 185 MB, version `6.5.0`; then `registerRea` into a scratch project and Sequence's MCP client listed 207 tools, and the read-only set derived from the live
  server's `binary_session` equalled the shipped one (128). The automated tests drive the same code against a local bare clone of a fixture, with no network.
