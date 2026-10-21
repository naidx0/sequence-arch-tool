#!/usr/bin/env node
// Vendors the pinned upstream agent skills into packages/analyzer/components.
//
//   node tools/components/vendor.mjs           fetch every pin, rewrite the catalog
//   node tools/components/vendor.mjs --check   validate the catalog on disk (exit 0 or 1)
//
// Fetching uses the gh CLI (already authenticated) through `gh api`. Nothing here needs npm packages.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SOURCES_PATH = path.join(HERE, "sources.json");
const OUT = path.join(ROOT, "packages/analyzer/components");
export const MAX_TOTAL_BYTES = 7 * 1024 * 1024;
const STATUSES = new Set(["ready", "review", "link-only"]);
const SHA_RE = /^[0-9a-f]{40}$/;
const CONTENTS_INLINE_LIMIT = 900 * 1024;

const GROUPS = [
  { id: "design", label: "Design elements" },
  { id: "visual", label: "Visual and video" },
  { id: "workflow", label: "Workflow and eval" },
  { id: "ml", label: "ML and research" },
  { id: "security", label: "Security" },
];

const PARENTS = [
  {
    id: "design/interface",
    group: "design",
    label: "Interface design",
    summary: "Design skills for interfaces covering layout, type, colour, motion, accessibility, state and review. Pick one sub-component.",
    triggers: ["interface design", "improve the ui", "make it look better", "design review", "polish this screen"],
  },
];

// ---------- gh access (rate-limited so a full vendor run stays polite) ----------

function limiter(max) {
  let active = 0;
  const queue = [];
  const pump = () => {
    if (active >= max || queue.length === 0) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => {
      active -= 1;
      pump();
    });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}
const gate = limiter(6);

async function ghApi(endpoint, attempts = 4) {
  // Transient TLS and rate errors are retried; a persistent failure still throws.
  for (let i = 1; ; i += 1) {
    try {
      return await ghApiOnce(endpoint);
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

function ghApiOnce(endpoint) {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      ["api", endpoint],
      { maxBuffer: 512 * 1024 * 1024, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`gh api ${endpoint} failed: ${String(stderr || err.message).trim()}`));
        else resolve(JSON.parse(stdout));
      },
    );
  });
}

const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

function mayDescend(rel, include) {
  return include.some((inc) => inc.endsWith("/") && (inc.startsWith(`${rel}/`) || `${rel}/`.startsWith(inc)));
}

function matchesInclude(rel, include) {
  return include.some((inc) => (inc.endsWith("/") ? rel.startsWith(inc) : rel === inc));
}

async function listRemote(repo, sha, remoteDir, relDir, include, out, excludeSuffix = []) {
  const entries = await gate(() => ghApi(`repos/${repo}/contents/${encPath(remoteDir)}?ref=${sha}`));
  if (!Array.isArray(entries)) throw new Error(`${repo}:${remoteDir} is not a directory`);
  for (const e of entries) {
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.type === "dir") {
      if (!include || mayDescend(rel, include)) await listRemote(repo, sha, e.path, rel, include, out, excludeSuffix);
    } else if (e.type === "file") {
      if ((!include || matchesInclude(rel, include)) && !excludeSuffix.some((x) => rel.endsWith(x))) out.push({ rel, remote: e.path, blobSha: e.sha, size: e.size });
    } else {
      throw new Error(`${repo}:${e.path} has unsupported type ${e.type}`);
    }
  }
  return out;
}

async function fetchRemoteFile(repo, sha, file) {
  let buf;
  if (file.size <= CONTENTS_INLINE_LIMIT) {
    const meta = await gate(() => ghApi(`repos/${repo}/contents/${encPath(file.remote)}?ref=${sha}`));
    if (meta.encoding === "base64" && typeof meta.content === "string" && meta.content.length > 0) {
      buf = Buffer.from(meta.content.replace(/\s+/g, ""), "base64");
    }
  }
  if (!buf) {
    // Contents API returns no inline body above 1 MB: fall back to the blob the listing named.
    const blob = await gate(() => ghApi(`repos/${repo}/git/blobs/${file.blobSha}`));
    if (blob.encoding !== "base64") throw new Error(`${repo}:${file.remote} blob encoding ${blob.encoding}`);
    buf = Buffer.from(blob.content.replace(/\s+/g, ""), "base64");
  }
  if (buf.length !== file.size) throw new Error(`${repo}:${file.remote} size ${buf.length} != listed ${file.size}`);
  return buf;
}

async function fetchRemoteText(repo, sha, remotePath) {
  const meta = await gate(() => ghApi(`repos/${repo}/contents/${encPath(remotePath)}?ref=${sha}`));
  return Buffer.from(meta.content.replace(/\s+/g, ""), "base64");
}

// Text files are normalised to LF; anything with a NUL byte is written byte for byte.
function normalise(buf) {
  if (buf.includes(0)) return buf;
  return Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
}

async function readLocalTree(absDir, rel = "", out = []) {
  const entries = await fs.readdir(path.join(absDir, rel), { withFileTypes: true });
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await readLocalTree(absDir, r, out);
    else if (e.isFile()) out.push(r);
  }
  return out;
}

// ---------- SKILL.md helpers ----------

function unquote(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

export function parseFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (top) {
      key = top[1];
      const v = top[2].trim();
      out[key] = /^[>|][-+]?$/.test(v) ? "" : unquote(v);
    } else if (key && /^\s+\S/.test(line)) {
      out[key] = out[key] ? `${out[key]} ${line.trim()}` : line.trim();
    }
  }
  return out;
}

function firstSentence(text) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  const m = flat.match(/^(.+?[.!?])(\s|$)/);
  let s = m ? m[1] : flat;
  if (s.length > 140) s = `${s.slice(0, 137).replace(/\s+\S*$/, "")}...`;
  return s;
}

const titleCase = (leaf) =>
  leaf
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

// ---------- planning: fetch everything into memory before touching disk ----------

// Sequence edits to a vendored skill. Each find string must occur exactly once in its file, so a
// changed upstream fails loudly instead of applying a stale edit. MODIFICATIONS.md records every edit.
async function applyPatch(files, patchPath, componentId, sha) {
  const patch = JSON.parse(await fs.readFile(path.join(ROOT, patchPath), "utf8"));
  const notes = [];
  for (const e of patch.edits) {
    const buf = files.get(e.file);
    if (!buf) throw new Error(`${componentId}: patch targets ${e.file}, which is not in the component`);
    const text = buf.toString("utf8");
    const count = text.split(e.find).length - 1;
    if (count !== 1) throw new Error(`${componentId}: patch edit for ${e.file} (${e.ref}) matched ${count} times, expected 1`);
    files.set(e.file, Buffer.from(text.replace(e.find, () => e.replace), "utf8"));
    notes.push(e);
  }
  const body = notes
    .map((e, i) => [
      `## ${i + 1}. ${e.file} (${e.ref})`,
      "",
      e.why,
      "",
      "Before:",
      "",
      "```",
      e.find,
      "```",
      "",
      "After:",
      "",
      "```",
      e.replace === "" ? "(removed)" : e.replace,
      "```",
      "",
    ].join("\n"))
    .join("\n");
  const header = [
    `# Modifications`,
    "",
    `Sequence changed these vendored files after the pinned upstream commit (${sha}). The upstream`,
    "project's MIT license is kept unchanged in LICENSE. Edits are applied by tools/components/vendor.mjs",
    `from ${patchPath}; a re-vendor reproduces them. ${patch.review}.`,
    "",
  ].join("\n");
  files.set("MODIFICATIONS.md", Buffer.from(header + "\n" + body, "utf8"));
}

async function buildComponents(sources, licenseText) {
  const components = [];
  for (const src of sources) {
    const kind = src.kind || "github";
    const sourceStatus = src.status || "ready";
    let licenseBuf = null;
    const extras = new Map();
    if (kind === "github" || kind === "wrapped") {
      // licenseFile null means the license comes per dir (licenseFrom); no repo-level file.
      if (src.licenseFile !== null) licenseBuf = await fetchRemoteText(src.repo, src.commit, src.licenseFile || "LICENSE");
      for (const extra of src.extraLicenseFiles || []) {
        extras.set(extra, await fetchRemoteText(src.repo, src.commit, extra));
      }
    }
    if (kind === "local") licenseBuf = await fs.readFile(path.join(ROOT, src.licenseFile || "LICENSE"));

    for (const dir of src.dirs) {
      const leaf = dir.leaf || path.posix.basename(dir.path);
      const group = dir.group || src.group;
      const parent = dir.parent || src.parent;
      const status = kind === "link-only" ? "link-only" : dir.status || sourceStatus;
      const files = new Map();

      if (kind === "github") {
        const list = await listRemote(src.repo, src.commit, dir.path, "", dir.include || null, [], dir.excludeSuffix || []);
        if (list.length === 0) throw new Error(`${src.id}:${dir.path} matched no files`);
        const fetched = await Promise.all(
          list.map(async (f) => [f.rel, normalise(await fetchRemoteFile(src.repo, src.commit, { ...f, remote: f.remote }))]),
        );
        for (const [rel, buf] of fetched) files.set(rel, buf);
      } else if (kind === "local" || kind === "wrapped") {
        const absDir = path.join(ROOT, dir.path);
        for (const rel of await readLocalTree(absDir)) {
          files.set(rel, normalise(await fs.readFile(path.join(absDir, rel))));
        }
      }

      const patches = dir.patches || src.patches;
      if (patches && kind === "github") await applyPatch(files, patches, `${group}/${leaf}`, src.commit);
      const preambleFrom = dir.preambleFrom || src.preambleFrom;
      if (preambleFrom) files.set("SEQUENCE.md", normalise(await fs.readFile(path.join(ROOT, preambleFrom))));

      let meta = null;
      let description = "";
      let skillText = null;
      if (files.has("SKILL.md")) {
        skillText = files.get("SKILL.md").toString("utf8");
        meta = parseFrontMatter(skillText);
        description = meta?.description || "";
      }

      const component = {
        id: `${group}/${leaf}`,
        group,
        label: dir.label || titleCase(leaf),
        summary: dir.summary || firstSentence(description),
        triggers: dir.triggers || [titleCase(leaf).toLowerCase(), `use ${titleCase(leaf).toLowerCase()}`, `${titleCase(leaf).toLowerCase()} help`],
        status,
        ...(parent ? { parent } : {}),
        license: src.license,
        source: {
          repo: src.repo,
          commit: src.commit,
          path: kind === "link-only" ? null : dir.path,
        },
        url: upstreamUrl(kind, src, dir),
        ...(dir.externalRefs ? { externalRefs: dir.externalRefs } : {}),
        ...(preambleFrom ? { preamble: "SEQUENCE.md" } : {}),
        ...(dir.setup ? { setup: dir.setup } : {}),
      };

      if (kind === "link-only") {
        if (!component.summary || !component.triggers) throw new Error(`${component.id}: link-only needs summary and triggers`);
        components.push({ component, files: new Map(), linkOnly: true });
        continue;
      }

      if (kind === "wrapped") {
        files.set(
          "NOTICE",
          Buffer.from(
            [
              "RSI-Anything",
              "Copyright 2026 RSI-Anything contributors.",
              `Wrapped by Sequence from https://github.com/${src.repo} at commit ${src.commit}.`,
              "SKILL.md in this folder is original Sequence text, written from the upstream README and docs/workflow.md.",
              "Project code is Apache-2.0 (see LICENSE). Third-party code, models and data keep their own terms,",
              "listed upstream in THIRD_PARTY_NOTICES.md.",
              "",
            ].join("\n"),
          ),
        );
      }

      const dirLicense = dir.licenseFrom ? await fetchRemoteText(src.repo, src.commit, dir.licenseFrom) : licenseBuf;
      files.set("LICENSE", normalise(dirLicense || licenseText));
      for (const [name, buf] of extras) files.set(name, normalise(buf));
      components.push({ component, files, linkOnly: false });
    }
  }
  return components;
}

function upstreamUrl(kind, src, dir) {
  if (kind === "github") return `https://github.com/${src.repo}/tree/${src.commit}/${dir.path}`;
  if (kind === "link-only" || kind === "wrapped") return `https://github.com/${src.repo}`;
  return null;
}

function parentComponent(components, licenseText) {
  const out = [];
  for (const p of PARENTS) {
    const children = components.filter((c) => c.component.parent === p.id);
    const lines = children.map((c) => `- \`${c.component.id}\`: ${c.component.summary}`);
    const skill = [
      "---",
      `name: ${p.id.split("/")[1]}`,
      `description: ${p.summary}`,
      "---",
      "",
      `# ${p.label}`,
      "",
      "This is an index, not a skill to run. Pick the one sub-component that matches the task, and load only that one.",
      "",
      "## Sub-components",
      "",
      ...lines,
      "",
    ].join("\n");
    out.push({
      component: {
        id: p.id,
        group: p.group,
        label: p.label,
        summary: p.summary,
        triggers: p.triggers,
        status: "ready",
        license: "MIT",
        source: { repo: "sequence", commit: null, path: "tools/components" },
        url: null,
      },
      files: new Map([
        ["SKILL.md", Buffer.from(skill, "utf8")],
        ["LICENSE", normalise(licenseText)],
      ]),
      linkOnly: false,
    });
  }
  return out;
}

async function writeCatalog(all) {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });
  let total = 0;
  for (const { component, files } of all) {
    const dir = path.join(OUT, component.group, component.id.split("/")[1]);
    await fs.mkdir(dir, { recursive: true });
    for (const [rel, buf] of files) {
      const target = path.join(dir, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, buf);
      total += buf.length;
    }
    const json = `${JSON.stringify(component, null, 2)}\n`;
    await fs.writeFile(path.join(dir, "component.json"), json, "utf8");
    total += Buffer.byteLength(json);
  }
  await fs.writeFile(path.join(OUT, "groups.json"), `${JSON.stringify({ groups: GROUPS }, null, 2)}\n`, "utf8");
  return total;
}

// ---------- validation ----------

export function checkSourcesDoc(doc) {
  const errors = [];
  if (!Array.isArray(doc.sources) || doc.sources.length === 0) return ["sources.json: no sources"];
  for (const s of doc.sources) {
    const where = `source ${s.id || "(no id)"}`;
    if (typeof s.license !== "string" || s.license.trim() === "") errors.push(`${where}: no license`);
    if (!["github", "wrapped", "local", "link-only"].includes(s.kind || "github")) errors.push(`${where}: bad kind ${s.kind}`);
    if (s.license === "none" && s.kind !== "link-only") errors.push(`${where}: license none but kind is ${s.kind}`);
    if (s.kind !== "local" && !SHA_RE.test(s.commit || "")) errors.push(`${where}: commit is not a 40-char SHA`);
    if (!Array.isArray(s.dirs) || s.dirs.length === 0) errors.push(`${where}: no dirs`);
  }
  return errors;
}

async function walkFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkFiles(p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const REF_EXT = "md|mjs|cjs|js|ts|tsx|jsx|json|py|yaml|yml|txt|html|css|svg|sh|cmd|ps1|png|webp|jpg|wasm";

// Relative paths a SKILL.md tells an agent to read or run: markdown link targets, and bare or
// backticked paths such as kit/lathe.mjs or references/craft.md. URLs and absolute paths are not refs.
export function extractRelativeRefs(text) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
  const found = new Set();
  for (const m of body.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) found.add(m[1]);
  const bare = new RegExp(String.raw`(?<![\w./@:-])((?:[\w.-]+/)+[\w.-]+\.(?:` + REF_EXT + String.raw`))(?![\w/])`, "g");
  // Directory segments before the last must be lowercase: src/Dialog.tsx is a path, React/Next.js is a name.
  for (const m of body.matchAll(bare)) {
    const segs = m[1].split("/");
    if (segs.slice(0, -1).every((seg) => /^[a-z0-9_.@-]+$/.test(seg))) found.add(m[1]);
  }
  return [...found]
    .map((r) => r.split("#")[0].split("?")[0])
    .filter((r) => r.length > 0 && !/^(https?:|mailto:|#|\/|~|\$|[A-Za-z]:)/.test(r) && !/[<>*{}$]/.test(r) && !r.includes("://"));
}

export async function checkCatalog(dir) {
  const errors = [];
  const groupsPath = path.join(dir, "groups.json");
  let groupIds = new Set();
  try {
    groupIds = new Set(JSON.parse(await fs.readFile(groupsPath, "utf8")).groups.map((g) => g.id));
  } catch (e) {
    errors.push(`groups.json missing or invalid: ${e.message}`);
  }

  const all = await walkFiles(dir);
  const total = (await Promise.all(all.map((f) => fs.stat(f)))).reduce((n, s) => n + s.size, 0);
  if (total > MAX_TOTAL_BYTES) errors.push(`catalog is ${total} bytes, over the 6 MB limit`);

  const manifests = all.filter((f) => path.basename(f) === "component.json");
  if (manifests.length === 0) errors.push("no component.json found");
  const ids = new Map();
  const byId = new Map();

  for (const manifestPath of manifests) {
    const compDir = path.dirname(manifestPath);
    const rel = path.relative(dir, compDir).split(path.sep).join("/");
    const where = rel;
    let c;
    try {
      c = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    } catch (e) {
      errors.push(`${where}: component.json does not parse (${e.message})`);
      continue;
    }
    const segs = rel.split("/");
    if (segs.length !== 2) errors.push(`${where}: component must sit at <group>/<leaf>`);
    const leaf = segs[1];
    const need = (k, ok) => {
      if (!ok(c[k])) errors.push(`${where}: component.json field ${k} missing or invalid`);
    };
    need("id", (v) => typeof v === "string" && v.length > 0);
    need("group", (v) => typeof v === "string" && groupIds.has(v));
    need("label", (v) => typeof v === "string" && v.trim().length > 0);
    need("summary", (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 140);
    need("triggers", (v) => Array.isArray(v) && v.length >= 3 && v.length <= 8 && v.every((t) => typeof t === "string" && t === t.toLowerCase() && t.trim().length > 0));
    need("status", (v) => STATUSES.has(v));
    need("license", (v) => typeof v === "string" && v.trim().length > 0);
    need("source", (v) => v && typeof v === "object" && typeof v.repo === "string" && "commit" in v && "path" in v);
    if (c.id !== undefined && c.id !== `${segs[0]}/${leaf}`) errors.push(`${where}: id ${c.id} does not match its location`);
    if (c.group !== undefined && c.group !== segs[0]) errors.push(`${where}: group ${c.group} does not match its folder`);
    if (c.parent !== undefined && typeof c.parent !== "string") errors.push(`${where}: parent must be a string id`);
    if (c.preamble !== undefined) {
      if (typeof c.preamble !== "string" || c.preamble.includes("/") || c.preamble.includes("\\")) {
        errors.push(`${where}: preamble must be a file name inside the component`);
      } else if (!(await exists(path.join(compDir, c.preamble)))) {
        errors.push(`${where}: preamble ${c.preamble} is missing from the component`);
      }
    }
    if (typeof c.id === "string") {
      if (ids.has(c.id)) errors.push(`${where}: duplicate id ${c.id}`);
      ids.set(c.id, where);
      byId.set(c.id, c);
    }

    const hasSkill = await exists(path.join(compDir, "SKILL.md"));
    const hasLicense = await exists(path.join(compDir, "LICENSE"));
    if (c.status === "link-only") {
      if (hasSkill) errors.push(`${where}: link-only component must not ship SKILL.md`);
      if (hasLicense) errors.push(`${where}: link-only component must not ship upstream content`);
      if (typeof c.url !== "string" || c.url.length === 0) errors.push(`${where}: link-only component needs url`);
      continue;
    }
    if (c.license === "none") errors.push(`${where}: component without a license must be link-only`);
    if (!hasSkill) {
      errors.push(`${where}: SKILL.md missing`);
    } else {
      const fm = parseFrontMatter(await fs.readFile(path.join(compDir, "SKILL.md"), "utf8"));
      if (!fm) errors.push(`${where}: SKILL.md has no front matter`);
      else {
        if (!fm.name) errors.push(`${where}: SKILL.md front matter has no name`);
        if (!fm.description) errors.push(`${where}: SKILL.md front matter has no description`);
      }
    }
    if (!hasLicense) errors.push(`${where}: LICENSE missing`);
    if (hasSkill) {
      // externalRefs lists paths a SKILL.md names that are not bundled on purpose: they live in the
      // upstream project (a clone of the repo), are example names in prose, or upstream has no such file.
      const text = await fs.readFile(path.join(compDir, "SKILL.md"), "utf8");
      const external = new Set(Array.isArray(c.externalRefs) ? c.externalRefs : []);
      const refs = new Set(extractRelativeRefs(text));
      for (const ref of refs) {
        const target = path.resolve(compDir, ref);
        const inside = target === compDir || target.startsWith(compDir + path.sep);
        const present = inside && (await exists(target));
        if (present && external.has(ref)) errors.push(`${where}: externalRefs lists ${ref}, but it is in the component; remove it`);
        else if (!present && !external.has(ref)) errors.push(`${where}: SKILL.md refers to ${ref}, which is not in the component`);
      }
      for (const ref of external) {
        if (!refs.has(ref)) errors.push(`${where}: externalRefs lists ${ref}, which SKILL.md does not refer to; remove it`);
      }
    }
    if (c.source && c.source.commit !== null && c.source.commit !== undefined && !SHA_RE.test(c.source.commit)) {
      errors.push(`${where}: source.commit is not a 40-char SHA`);
    }
  }

  for (const [id, c] of byId) {
    if (c.parent && !byId.has(c.parent)) errors.push(`${id}: parent ${c.parent} is not in the catalog`);
  }

  return { errors, total, count: manifests.length, byId };
}

// ---------- main ----------

async function vendor() {
  const doc = JSON.parse(await fs.readFile(SOURCES_PATH, "utf8"));
  const problems = checkSourcesDoc(doc);
  if (problems.length) throw new Error(problems.join("\n"));
  const licenseText = await fs.readFile(path.join(ROOT, "LICENSE"));

  const built = await buildComponents(doc.sources, licenseText);
  const parents = parentComponent(built, licenseText);
  const all = [...parents, ...built];
  const total = await writeCatalog(all);

  const byGroup = {};
  for (const { component } of all) byGroup[component.group] = (byGroup[component.group] || 0) + 1;
  console.log(`wrote ${all.length} components to ${path.relative(ROOT, OUT)}`);
  console.log(`per group: ${JSON.stringify(byGroup)}`);
  console.log(`total bytes: ${total}`);
}

async function runCheck() {
  const doc = JSON.parse(await fs.readFile(SOURCES_PATH, "utf8"));
  const errors = [...checkSourcesDoc(doc)];
  const catalog = await checkCatalog(OUT);
  errors.push(...catalog.errors);
  if (errors.length) {
    for (const e of errors) console.error(`FAIL ${e}`);
    console.error(`check failed: ${errors.length} problem(s)`);
    return 1;
  }
  console.log(`check ok: ${catalog.count} components, ${catalog.total} bytes`);
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const run = process.argv.includes("--check") ? runCheck() : vendor().then(() => 0);
  run.then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.stack || String(err));
      process.exit(1);
    },
  );
}

