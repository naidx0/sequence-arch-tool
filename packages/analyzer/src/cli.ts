#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  POLICY_EXIT,
  checkPolicyBetweenScans,
  policyExitCode,
  validateGraph,
  type ArchGraph,
  type PolicyBaseline,
} from '@sequence/schema';
import { readPolicies } from './server/store.js';
import { scanRepo } from './scan.js';
import { scanRepoCached } from './server/graphCache.js';
import { buildPlainTree } from './explain/explain.js';
import { renderOutline } from './explain/plaintree.js';
import { buildTree } from './server/tree.js';
import { scoreGraph } from './score.js';
import { diffGraphs } from './diff.js';
import { renderBrief } from './brief.js';
import { serveGraph, serveRepo, serveApp } from './serve.js';
import { openBrowser } from './open-browser.js';
import { mermaidSequence, mermaidFlow, dependencyMatrix, archToMarkdown } from '@sequence/export';
import { listAgents, addAgent, removeAgent } from './server/agentsStore.js';
import { userStoreDir } from './server/store.js';
import { isRepoTrusted, readRepoTrust, repoTrustKey, setRepoTrust } from './server/repoTrust.js';
import { runProgramFile } from './programRun.js';
import { runDoctor, formatDoctor } from './doctor.js';
import { runDiagramValidate, runDiagramExport } from './diagramCli.js';
import { runAskCli } from './askCli.js';
import { runHarnessCli } from './refineCli.js';

function usage(exitCode = 1): never {
  console.log(`sequence — static architecture scanner + viewer

usage:
  sequence [--repo <dir>] [--port <n>] [--no-open]   launch the app (opens your browser)
  sequence app [--repo <dir>] [--port <n>] [--no-open]   (same as above)
  sequence ask <question> [--repo <dir>] [--json] [--stdin] [--mode <m>]
  sequence scan <repo-path> [--out <file>] [--no-cluster] [--llm] [--no-cache]
  sequence explain <repo-path> [--out <file>]
  sequence score <archgraph.json> <ground-truth.json>
  sequence diff <base.json> <head.json> [--markdown <outfile>]
  sequence validate <spec.json>
  sequence policy <before> <after> [--baseline <file.json>]   CI gate; exits 0/1/2
  sequence scaffold-brief <spec.json> [--out <file.md>]
  sequence export <graph.json> --format <fmt> [--out <file>]
  sequence diagram validate <file.seqd>
  sequence diagram export <graph.json> --format <fmt> [--out <file>]
  sequence diagram export --repo <dir> --format <fmt> [--out <file>]
  sequence serve [<archgraph.json>] [--repo <dir>] [--port <n>] [--web <dist-dir>]
  sequence doctor [<repo-path>]                      is everything working? (see below)
  sequence trust <repo-path> [--revoke]              let this repo direct + run (see below)
  sequence trust list                                which repositories you have trusted
  sequence harness <refine|distill|list> [--repo <dir>] [--json]   the learning loop, by hand

policy — run .sequence/policies/*.json against what a change ADDED:
  <before> and <after> are each a repo directory or a saved graph JSON. Only
  edges the change introduced are judged: a violation present in both is the
  repository's status quo, and failing a PR for it would fail every PR until
  someone fixed a thing they did not touch.
  --baseline accepts violations a team has decided to live with, so a rule is
  adoptable in a repo that already breaks it. Accepted ones are still printed,
  and an entry that no longer fires is reported as safe to delete.
  Exit codes:  0 clean   1 a rule blocked an addition   2 the check could not run
  (three, not two, so CI can tell "the rules said no" from "the checker fell over")

trust — one explicit decision per repository, and it is NOT stored in the repo:
  A repository you have not trusted is read, scanned and drawn exactly as
  before. What it cannot do is DIRECT or RUN: its AGENTS.md / CLAUDE.md is not
  fed to the model as standing instruction, "run_command" (and the done-when
  gate) refuse, and any .sequence/permissions.json it ships is ignored — a
  repository controls what its own commands mean, so running one is running its
  code.
  The decision lives in ~/.sequence/repo-trust.json (moved by SEQUENCE_USER_DIR),
  keyed by the canonical path, so a repository can never mark itself trusted and
  a symlinked spelling cannot dodge a decision you already made.

doctor — the end-to-end operational check:
  Runs every subsystem and reports pass/fail/skip with the REASON, split into
  the half that needs NO key (scanning, services, edges, module descriptions,
  the plain-English tree) and the half that needs a model (names, assistant).
  If the first half fails, an AI key will not fix it. Spends at most one
  1-token request to prove your key + host + model id actually answer.

  sequence agent add <id> --command <bin> [--args "a b c"] [--cwd <dir>] [--label <name>]
  sequence agent list
  sequence agent remove <id>
  sequence program run <file.json> [--agent <id>] [--input k=v ...] [--timeout <ms>]

headless (pipes) — the unattended path:
  sequence ask     answer a question about a repo and write ONLY the answer to
                   stdout, so it composes:
                       sequence ask "what calls quote?" | grep -i rates
                   Progress and coverage go to STDERR; the exit code is honest
                   (0 answered, 2 usage, 3 no provider, 4 provider failed,
                   5 repo unusable, 6 cancelled). --stdin reads the question
                   from a pipe, --json emits a machine-readable object. It runs
                   the SAME grounded ask pipeline the app runs.

local agents (ACP):
  register the coding agents installed on your machine (Claude Code / Codex /
  Gemini / Copilot) in ~/.sequence/agents.json, then run a Program graph against
  one with "program run". A runtime:'acp' agent node drives your OWN local agent
  as a subprocess (your machine, your agent, your cost) — never a hosted runner.

export formats (work on both scan graphs and design specs):
  mermaid-seq    a Mermaid sequenceDiagram of service-level interactions
  mermaid-flow   a Mermaid C4-ish flowchart TD grouped by kind
  matrix-md      a who-calls-whom dependency matrix as a Markdown table
  matrix-csv     the same dependency matrix as CSV
  arch-md        the canonical Architecture Markdown spec (service-level)

diagram export formats (from graph.json or --repo scan):
  seqd           grounded SeqDiagram v1 JSON IR (.seqd)
  svg            Structural theme SVG from the IR
  mermaid        derived Mermaid projection (flow or sequence)

launch (the app shell):
  sequence           with no subcommand, or "sequence app": start the platform
                     server and open your default browser to it. Pass --repo to
                     attach a repo on startup, or start with none and pick one
                     from the home screen. --no-open suppresses the auto-open.

serve modes:
  <archgraph.json>   serve a frozen graph file + the web viewer (unchanged).
  --repo <dir>       scan <dir> on startup and serve it live as the local
                     platform backend (localhost only): the web viewer plus a
                     JSON API — GET /api/tree, GET /api/file?path=,
                     POST /api/scan, POST /api/generate, POST /api/prompt-file
                     (per-project memory under <dir>/.sequence/). To compare a
                     design spec against a scan without the server, use
                     "sequence diff <spec.json> <scan.json>".
  (no argument)      start the server with no repo attached yet and serve the web
                     app's home screen (attach a repo from the UI).
`);
  process.exit(exitCode);
}

function flag(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i >= 0) {
    args.splice(i, 1);
    return true;
  }
  return false;
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && i + 1 < args.length) {
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  }
  return undefined;
}

/** Collect EVERY occurrence of a repeatable `--name value` flag (e.g. `--input`). */
function optAll(args: string[], name: string): string[] {
  const out: string[] = [];
  let v: string | undefined;
  while ((v = opt(args, name)) !== undefined) out.push(v);
  return out;
}

/**
 * The launchable app shell: start the platform server and (unless suppressed)
 * open the default browser to it. This is what runs for a bare `sequence`, for
 * `sequence app`, or for `sequence -<flags>`.
 *
 * A repo may be attached up front (`--repo <dir>` or a positional dir); with
 * none, the server starts with no repo attached and Phase B's home screen takes
 * over. `--no-open` suppresses the browser auto-open (headless / test / CI).
 * Returns the listening server so callers (and tests) can read the bound port.
 */
export async function launch(args: string[]): Promise<http.Server> {
  const noOpen = flag(args, '--no-open');
  const port = Number(opt(args, '--port') ?? 4173);
  const web = opt(args, '--web');
  const repo = opt(args, '--repo') ?? args.shift();

  const server = await serveApp(repo, port, web);
  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = `http://127.0.0.1:${boundPort}`;

  console.log('');
  console.log('  Sequence — local architecture app');
  console.log(`  ▸ ${url}`);
  if (repo) {
    console.log(`  ▸ repo: ${path.resolve(repo)}`);
  } else {
    console.log('  ▸ no repo attached yet — attach one from the home screen');
  }
  console.log(noOpen ? '  ▸ browser auto-open disabled (--no-open)' : '  ▸ opening your browser…');
  console.log('  ▸ press Ctrl+C to stop');
  console.log('');

  if (!noOpen) openBrowser(url);
  return server;
}

async function main() {
  const args = process.argv.slice(2);
  const first = args[0];

  if (first === '-h' || first === '--help') usage(0);

  // Bare `sequence`, `sequence app`, or a leading flag (e.g. `sequence --port 4900`)
  // launch the app shell. Named subcommands (scan/serve/…) never start with `-`,
  // so they fall through to the dispatcher below.
  if (first === undefined || first === 'app' || first.startsWith('-')) {
    if (first === 'app') args.shift();
    await launch(args);
    return;
  }

  const cmd = args.shift();

  if (cmd === 'scan') {
    const out = opt(args, '--out') ?? 'archgraph.json';
    const noCluster = flag(args, '--no-cluster');
    const llm = flag(args, '--llm');
    // An unchanged repo reuses its last graph. --no-cache forces a real parse, which
    // is what you want when measuring, or when you suspect a stale entry.
    const noCache = flag(args, '--no-cache');
    const repo = args.shift();
    if (!repo) usage();
    const t0 = Date.now();
    /**
     * Reuse the persisted graph when the repo is unchanged.
     *
     * P5 measured `scan` at ~3.9s on this monorepo, re-run in full every time even
     * with nothing changed. The app server has ALWAYS cached (`server/graphCache.ts`,
     * the "persistence moat"); the CLI simply never asked for it, so the two paths
     * disagreed about how expensive a rescan was.
     *
     * Measured after wiring: 3.96s cold, 0.38s warm, 10.4x on an unchanged repo.
     */
    const scanOpts = { cluster: !noCluster, llm };
    const graph = noCache ? await scanRepo(repo, scanOpts) : await scanRepoCached(repo, scanOpts);
    fs.writeFileSync(out, JSON.stringify(graph, null, 1));
    const services = graph.nodes.filter((n) => n.kind === 'service').length;
    const files = graph.nodes.filter((n) => n.kind === 'file').length;
    const interactions = graph.edges.filter((e) => e.kind !== 'import').length;
    const imports = graph.edges.filter((e) => e.kind === 'import').length;
    console.log(
      `scanned ${graph.repoName} in ${((Date.now() - t0) / 1000).toFixed(1)}s: ` +
        `${services} services, ${files} files, ${interactions} interaction edges, ${imports} import edges`
    );
    if (graph.warnings.length > 0) {
      console.log(`\nwarnings (${graph.warnings.length}):`);
      for (const w of graph.warnings) console.log(`  - ${w}`);
    }
    console.log(`\nwrote ${path.resolve(out)}`);
    return;
  }

  if (cmd === 'explain') {
    const out = opt(args, '--out');
    const repo = args.shift();
    if (!repo) usage();
    // Scan for the deterministic STRUCTURE, then translate it to a plain-English
    // outline. The CLI has no attached AI provider, so this prints the STRUCTURAL
    // fallback (no key needed) — the AI grouping/labels are produced by
    // POST /api/explain in the running app once a key is connected.
    const graph = await scanRepo(repo, { cluster: true });
    const { tree, mode } = await buildPlainTree(graph, { tree: buildTree(path.resolve(repo)) });
    const outline = renderOutline(tree, { color: !out && process.stdout.isTTY === true });
    if (out) {
      fs.writeFileSync(out, outline + '\n');
      console.error(`wrote ${path.resolve(out)}`);
    } else {
      console.log(outline);
      console.log('');
      console.log(
        `  (${mode} translation — structure is deterministic; connect an AI key in the app for AI grouping/labels)`
      );
    }
    /*
     * RETURN, DO NOT `process.exit(0)`.
     *
     * `explain` runs a full scan, so the tree-sitter WASM parser's async handles
     * are still being torn down when this line is reached. Forcing the process
     * down on top of that tripped libuv's own assertion on Windows —
     *
     *     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
     *     file src\win\async.c, line 76
     *
     * — after the outline had already been printed in full. Every run: correct
     * output on stdout, then a native crash and exit code 127, so any script
     * that checked the status of `sequence explain` saw a failure on every
     * Windows machine. 5 runs out of 5 before this change, 0 after.
     *
     * Returning lets the loop drain and the process exit 0 on its own — which is
     * what `scan` already does, and why `scan` never showed this.
     */
    return;
  }

  if (cmd === 'score') {
    const [graphPath, truthPath] = args;
    if (!graphPath || !truthPath) usage();
    const { precision, recall, report } = scoreGraph(graphPath, truthPath);
    console.log(report);
    process.exit(precision >= 0.8 && recall >= 0.6 ? 0 : 2);
  }

  if (cmd === 'diff') {
    const markdownOut = opt(args, '--markdown');
    const [basePath, headPath] = args;
    if (!basePath || !headPath) usage();
    const { added, removed, mismatched, markdown } = diffGraphs(basePath, headPath);
    console.log(markdown);
    if (markdownOut) fs.writeFileSync(markdownOut, markdown);
    process.exit(added.length + removed.length + mismatched.length === 0 ? 0 : 3);
  }

  if (cmd === 'validate') {
    const specPath = args.shift();
    if (!specPath) usage();
    const graph = JSON.parse(fs.readFileSync(specPath, 'utf8')) as ArchGraph;
    const problems = validateGraph(graph);
    if (problems.length > 0) {
      console.error(`invalid (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(2);
    }
    const mode = graph.mode ?? 'scan';
    console.log(
      `valid (${graph.nodes.length} nodes, ${graph.edges.length} edges, mode: ${mode})`
    );
    for (const w of graph.warnings ?? []) console.log(`  warning: ${w}`);
    process.exit(0);
  }

  /*
   * POLICY IN CI — the exit-code contract.
   *
   * `checkPolicy` judges a canvas mutation, so the rules could judge a proposal
   * and could not judge a pull request. This runs them over TWO SCANS and
   * returns a number a build can act on:
   *
   *     0  clean
   *     1  a rule blocked something this change ADDED
   *     2  the checker could not run (bad path, unreadable policy)
   *
   * Three codes rather than two, because CI must be able to tell "the rules
   * said no" from "the checker fell over"; one code for both teaches a team to
   * treat its own crashes as policy failures.
   *
   * ONLY WHAT THE CHANGE ADDED. A violation present in both scans is the
   * repository's status quo, and failing a PR for it would fail every PR until
   * someone fixed a thing they did not touch. `.sequence/policy-baseline.json`
   * accepts the ones a team has decided to live with, so a rule is adoptable in
   * a repo that already breaks it — and the accepted ones are still PRINTED,
   * because a ratchet whose debt is invisible is just a mute failure.
   */
  if (cmd === 'policy') {
    const baselinePath = opt(args, '--baseline');
    const [beforeArg, afterArg] = args;
    if (!beforeArg || !afterArg) usage();
    try {
      const loadGraph = async (p: string): Promise<ArchGraph> =>
        p.endsWith('.json')
          ? (JSON.parse(fs.readFileSync(p, 'utf8')) as ArchGraph)
          : await scanRepo(p, { cluster: true });

      const before = await loadGraph(beforeArg!);
      const after = await loadGraph(afterArg!);
      /* `readPolicies` is the server's own loader, reused rather than
         reimplemented — and its warnings are PRINTED. A policy the user
         believes is enforced and which the tool quietly ignored is the worst
         outcome this feature can produce. */
      const loaded = readPolicies(after.repoRoot || afterArg!);
      for (const w of loaded.warnings) console.error(`policy file not loaded: ${w}`);
      const policies = loaded.policies;
      const baseline = baselinePath
        ? (JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as PolicyBaseline)
        : undefined;

      const verdict = checkPolicyBetweenScans(before, after, policies, baseline);

      for (const hit of verdict.blocks) console.error(`BLOCK  ${hit.explanation}`);
      for (const hit of verdict.warns) console.log(`warn   ${hit.explanation}`);
      for (const hit of verdict.baselined) console.log(`accepted (baseline)  ${hit.explanation}`);
      for (const key of verdict.staleBaseline) {
        /* A baseline that can only grow stops meaning anything. */
        console.log(`stale baseline entry (no longer fires, safe to delete): ${key}`);
      }

      if (policies.length === 0) {
        console.log('no policies found — nothing to check (.sequence/policies/*.json)');
      } else if (verdict.ok) {
        console.log(`policy: ok (${policies.length} polic${policies.length === 1 ? 'y' : 'ies'})`);
      }
      process.exit(policyExitCode(verdict));
    } catch (e) {
      console.error(`policy: ${(e as Error).message}`);
      process.exit(POLICY_EXIT.error);
    }
  }

  if (cmd === 'scaffold-brief') {
    const out = opt(args, '--out');
    const specPath = args.shift();
    if (!specPath) usage();
    let brief: string;
    try {
      brief = renderBrief(specPath);
    } catch (e) {
      console.error(`scaffold-brief: ${(e as Error).message}`);
      process.exit(2);
    }
    if (out) {
      fs.writeFileSync(out, brief);
      console.error(`wrote ${path.resolve(out)}`);
    } else {
      console.log(brief);
    }
    process.exit(0);
  }

  if (cmd === 'export') {
    const out = opt(args, '--out');
    const format = opt(args, '--format');
    const graphPath = args.shift();
    if (!graphPath) usage();
    const formats: Record<string, (g: ArchGraph) => string> = {
      'mermaid-seq': (g) => mermaidSequence(g),
      'mermaid-flow': (g) => mermaidFlow(g),
      'matrix-md': (g) => dependencyMatrix(g).markdown,
      'matrix-csv': (g) => dependencyMatrix(g).csv,
      'arch-md': (g) => archToMarkdown(g),
    };
    const render = format ? formats[format] : undefined;
    if (!render) {
      console.error(
        `export: unknown format '${format ?? ''}'. expected one of: ${Object.keys(formats).join(', ')}`
      );
      process.exit(2);
    }
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')) as ArchGraph;
    const text = render(graph);
    if (out) {
      fs.writeFileSync(out, text);
      console.error(`wrote ${path.resolve(out)}`);
    } else {
      process.stdout.write(text);
    }
    process.exit(0);
  }

  if (cmd === 'serve') {
    // Accepted + ignored: `serve` never auto-opens a browser (that is the launch
    // command's job), so this keeps `serve --no-open` from being mistaken for a
    // positional graph path. Backward-compat serve modes are unchanged.
    flag(args, '--no-open');
    const port = Number(opt(args, '--port') ?? 4173);
    const web = opt(args, '--web');
    const repo = opt(args, '--repo');
    if (repo) {
      // Live platform backend: scan the repo and serve it + the JSON API.
      await serveRepo(repo, port, web);
      return;
    }
    // Frozen-graph mode (unchanged): serve a prebuilt archgraph.json.
    const graphPath = args.shift();
    if (graphPath) {
      serveGraph(graphPath, port, web);
      return;
    }
    // No repo and no graph: previously this errored. Now start the platform
    // server with no repo attached yet and serve the web app so Phase B's home
    // screen can take over (browse + attach a repo as a UI action). The no-repo
    // start itself is implemented on the server side by Phase B — serveApp only
    // binds it (see serve.ts).
    const server = await serveApp(undefined, port, web);
    const addr = server.address();
    const boundPort = typeof addr === 'object' && addr ? addr.port : port;
    console.log('sequence: serving with no repo attached yet — attach one from the web app');
    console.log(`  http://127.0.0.1:${boundPort}`);
    return;
  }

  // ---- sequence ask <question> — the HEADLESS entry point (P14) ----
  // The one verb that composes with Unix pipes. Everything it has to be honest
  // about (stdout carries the answer and nothing else; the exit code tells
  // "bad usage" from "no key" from "provider failed") lives in askCli.ts — this
  // dispatcher only hands over argv and the resulting exit code.
  if (cmd === 'ask') {
    /*
     * EXIT CODE, NOT `process.exit()` — the same libuv assertion `explain`
     * already fixed above, still live on this path.
     *
     * Practical ML's walk of Teach mode, 2026-09-05: a four-turn lesson whose
     * last turn printed a complete, well-worded refusal and then, underneath it,
     *
     *     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
     *     file src\win\async.c, line 76
     *
     * with exit code 127 and a trailing bare CR where stdout was cut mid-write.
     * An ask runs a full scan, so the tree-sitter WASM parser's async handles are
     * still being torn down when this line is reached, exactly as the note at the
     * `explain` branch describes — and a script checking the status of
     * `sequence ask` sees a failure on every Windows machine, after a correct
     * answer.
     *
     * Setting `process.exitCode` and returning lets the loop drain and the
     * process exit with the intended code on its own.
     */
    process.exitCode = await runAskCli(args);
    return;
  }

  // ---- sequence harness refine|distill|list — the learning loop, by hand ----
  // The /api/harness/* routes had no caller anywhere (audit G4). This verb and
  // the ask route's post-error hook (learningLoop.ts) are the two real ones.
  // It only PROPOSES; accept stays on the verify-gated route. See refineCli.ts.
  if (cmd === 'harness') {
    /* Same reason as `ask` above: the harness verbs scan, so forcing the loop
       down races the parser's teardown. */
    process.exitCode = await runHarnessCli(args);
    return;
  }

  // ---- sequence doctor [repo] — is this install operational, end to end? ----
  // One command that answers "does everything actually work", and separates the
  // half that needs no key from the half that does. See doctor.ts.
  if (cmd === 'doctor') {
    const repoArg = args.find((a) => !a.startsWith('-'));
    const report = await runDoctor({ repoPath: repoArg });
    console.log(formatDoctor(report));
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  /* ---- sequence trust <repo> [--revoke] | trust list — the boundary, headless ----
   *
   * WITHOUT THIS THE BOUNDARY IS A TRAP. `run_command`, the done-when gate and
   * the harness's own post-write checks all refuse under an untrusted
   * repository (`server/repoTrust.ts`), and the only way to grant trust was a
   * button in the web UI. Every headless path — `sequence ask` in a pipe, the
   * SWE-bench harness against `/testbed`, CI — would have had no way to say
   * yes, and the first person to hit that would have deleted the gate instead
   * of using it. A boundary with no usable consent is a boundary that gets
   * removed.
   *
   * It writes the SAME user-level store the gates read (`~/.sequence`, moved
   * only by `SEQUENCE_USER_DIR`), keyed by the canonical root, so a decision
   * made here is the decision the app and the server see. There is deliberately
   * no `--all` and no wildcard: one root, one explicit act.
   */
  if (cmd === 'trust') {
    const sub = args[0];
    if (sub === 'list') {
      const trusted = readRepoTrust(userStoreDir()).trusted;
      if (trusted.length === 0) console.log('no repositories are trusted');
      else for (const t of trusted) console.log(t);
      return;
    }
    const revoke = args.includes('--revoke');
    const repoArg = args.find((a) => !a.startsWith('-'));
    if (!repoArg) usage();
    const key = repoTrustKey(repoArg);
    if (key === null) {
      /* Honest error: the path is the thing that failed, and saying "not
         trusted" here would hide a typo as a policy decision. */
      console.error(`sequence trust: no such directory: ${repoArg}`);
      process.exitCode = 5;
      return;
    }
    setRepoTrust(userStoreDir(), key, !revoke);
    const now = isRepoTrusted(key);
    /* Report what the STORE says afterwards, not what was asked for — a
       read-only home must not print success. */
    console.log(`${now ? 'trusted' : 'not trusted'}: ${key}`);
    process.exitCode = now === !revoke ? 0 : 1;
    return;
  }

  // ---- sequence agent add|list|remove — manage ~/.sequence/agents.json ----
  // The LOCAL registry of coding agents you can drive over ACP. User-level (spans
  // every repo); holds no secret. See server/agentsStore.ts.
  if (cmd === 'agent') {
    const sub = args.shift();
    const storeDir = userStoreDir();

    if (sub === 'add') {
      const command = opt(args, '--command');
      const argsStr = opt(args, '--args');
      const cwd = opt(args, '--cwd');
      const label = opt(args, '--label');
      const id = args.shift();
      if (!id || !command) {
        console.error('usage: sequence agent add <id> --command <bin> [--args "a b c"] [--cwd <dir>] [--label <name>]');
        process.exit(2);
      }
      try {
        addAgent(storeDir, {
          id,
          command,
          ...(argsStr ? { args: argsStr.split(/\s+/).filter((a) => a !== '') } : {}),
          ...(cwd ? { cwd } : {}),
          ...(label ? { label } : {}),
        });
      } catch (e) {
        console.error(`agent add: ${(e as Error).message}`);
        process.exit(2);
      }
      console.log(`added local agent '${id}' → ${command}${argsStr ? ' ' + argsStr : ''}`);
      console.log(`  (saved to ${path.join(storeDir, 'agents.json')})`);
      process.exit(0);
    }

    if (sub === 'list') {
      const agents = listAgents(storeDir);
      if (agents.length === 0) {
        console.log('no local agents registered — add one with: sequence agent add <id> --command <bin>');
        process.exit(0);
      }
      console.log(`${agents.length} local agent${agents.length === 1 ? '' : 's'} (${path.join(storeDir, 'agents.json')}):`);
      for (const a of agents) {
        const cmd = [a.command, ...(a.args ?? [])].join(' ');
        const suffix = [a.label ? `"${a.label}"` : '', a.cwd ? `cwd=${a.cwd}` : ''].filter(Boolean).join(' ');
        console.log(`  ${a.id}\t${cmd}${suffix ? '\t' + suffix : ''}`);
      }
      process.exit(0);
    }

    if (sub === 'remove') {
      const id = args.shift();
      if (!id) {
        console.error('usage: sequence agent remove <id>');
        process.exit(2);
      }
      const { removed } = removeAgent(storeDir, id);
      if (removed) {
        console.log(`removed local agent '${id}'`);
        process.exit(0);
      }
      console.error(`no local agent '${id}' to remove`);
      process.exit(2);
    }

    console.error('usage: sequence agent <add|list|remove> …');
    process.exit(2);
  }

  // ---- sequence diagram validate|export — SeqDiagram v1 files + projections ----
  if (cmd === 'diagram') {
    const sub = args.shift();
    if (sub === 'validate') {
      const file = args.shift();
      if (!file) {
        console.error('usage: sequence diagram validate <file.seqd>');
        process.exit(2);
      }
      process.exit(runDiagramValidate(file));
    }
    if (sub === 'export') {
      /* Same reason as `ask` above. */
      process.exitCode = await runDiagramExport(args);
      return;
    }
    console.error('usage: sequence diagram <validate|export> …');
    process.exit(2);
  }

  // ---- sequence program run <file.json> — run a Program locally over ACP ----
  if (cmd === 'program') {
    const sub = args.shift();
    if (sub === 'run') {
      const agentId = opt(args, '--agent');
      const timeoutStr = opt(args, '--timeout');
      const inputPairs = optAll(args, '--input');
      const file = args.shift();
      if (!file) {
        console.error('usage: sequence program run <file.json> [--agent <id>] [--input k=v ...] [--timeout <ms>] [--json]');
        process.exit(2);
      }
      const inputs: Record<string, string> = {};
      for (const pair of inputPairs) {
        const eq = pair.indexOf('=');
        if (eq <= 0) {
          console.error(`program run: --input must be key=value (got '${pair}')`);
          process.exit(2);
        }
        inputs[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
      const timeoutMs = timeoutStr !== undefined ? Number(timeoutStr) : undefined;
      if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
        console.error(`program run: --timeout must be a positive number of milliseconds (got '${timeoutStr}')`);
        process.exit(2);
      }

      // Ctrl-C → abort: the scheduler cancels the in-flight ACP turn and the run's
      // finally kills every spawned agent child (SIGTERM→SIGKILL). Truly cancels.
      const controller = new AbortController();
      const onSigint = (): void => controller.abort();
      process.on('SIGINT', onSigint);
      try {
        const outcome = await runProgramFile(file, {
          /* `--json` makes the one command that runs a whole workflow
             composable with everything else — CANON names Unix composition as
             the shape to match, and this was the command that could not. */
          ...(args.includes('--json') ? { json: true } : {}),
          ...(agentId ? { agentId } : {}),
          ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          signal: controller.signal,
        });
        process.exit(outcome.exitCode);
      } finally {
        process.off('SIGINT', onSigint);
      }
    }

    console.error('usage: sequence program run <file.json> [--agent <id>] [--input k=v ...] [--timeout <ms>]');
    process.exit(2);
  }

  // Unknown word (e.g. `./start.sh codeforge` forwarded a folder name that is
  // not a CLI subcommand). Dumping the full usage page here looks like a crash
  // because usage() used to exit 1 with no "unknown command" line.
  console.error(`sequence: unknown command '${cmd}'`);
  console.error('');
  console.error('To start the app:');
  console.error('  ./start.sh');
  console.error('  ./start.sh /path/to/repo');
  console.error('  sequence app [--repo <dir>] [--port <n>] [--no-open]');
  console.error('');
  console.error('See `sequence --help` for all commands.');
  process.exit(1);
}

// Run only when invoked as the CLI entrypoint (node dist/cli.js / the `sequence`
// bin), NOT when imported by a test that exercises `launch` in-process.
const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`sequence: ${(e as Error).message}`);
    process.exit(1);
  });
}
