// Run with: node --test tools/components/vendor.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCatalog, checkSourcesDoc, extractRelativeRefs, MAX_TOTAL_BYTES } from "./vendor.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHA = "0123456789abcdef0123456789abcdef01234567";

const manifest = (over = {}) => ({
  id: "design/good",
  group: "design",
  label: "Good",
  summary: "A good component.",
  triggers: ["good one", "a good test", "check the good"],
  status: "ready",
  license: "MIT",
  source: { repo: "example/repo", commit: SHA, path: "skills/good" },
  url: "https://example.com/good",
  ...over,
});

const skill = "---\nname: good\ndescription: A good component.\n---\n\n# Good\n";

async function fixture(build) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "seq-catalog-"));
  await fs.writeFile(path.join(dir, "groups.json"), JSON.stringify({ groups: [{ id: "design", label: "Design elements" }] }));
  await build(dir);
  return dir;
}

async function writeComponent(root, group, leaf, files) {
  const dir = path.join(root, group, leaf);
  await fs.mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), body);
  }
  return dir;
}

test("a complete component passes the check", async () => {
  const dir = await fixture((root) =>
    writeComponent(root, "design", "good", {
      "SKILL.md": skill,
      LICENSE: "MIT License\n",
      "component.json": JSON.stringify(manifest()),
    }),
  );
  const result = await checkCatalog(dir);
  assert.deepEqual(result.errors, []);
  assert.equal(result.count, 1);
});

test("a component with no LICENSE file fails", async () => {
  const dir = await fixture((root) =>
    writeComponent(root, "design", "good", {
      "SKILL.md": skill,
      "component.json": JSON.stringify(manifest()),
    }),
  );
  const result = await checkCatalog(dir);
  assert.ok(result.errors.some((e) => /design\/good: LICENSE missing/.test(e)), result.errors.join("\n"));
});

test("a link-only component that ships SKILL.md fails", async () => {
  const dir = await fixture((root) =>
    writeComponent(root, "design", "good", {
      "SKILL.md": skill,
      "component.json": JSON.stringify(
        manifest({ status: "link-only", license: "none", source: { repo: "example/repo", commit: SHA, path: null } }),
      ),
    }),
  );
  const result = await checkCatalog(dir);
  assert.ok(result.errors.some((e) => /link-only component must not ship SKILL.md/.test(e)), result.errors.join("\n"));
});

test("a link-only component with no upstream content passes", async () => {
  const dir = await fixture((root) =>
    writeComponent(root, "design", "good", {
      "component.json": JSON.stringify(
        manifest({ status: "link-only", license: "none", source: { repo: "example/repo", commit: SHA, path: null } }),
      ),
    }),
  );
  assert.deepEqual((await checkCatalog(dir)).errors, []);
});

test("duplicate ids and a missing parent are reported", async () => {
  const dir = await fixture(async (root) => {
    const files = { "SKILL.md": skill, LICENSE: "MIT\n" };
    await writeComponent(root, "design", "good", { ...files, "component.json": JSON.stringify(manifest()) });
    await writeComponent(root, "design", "twin", {
      ...files,
      "component.json": JSON.stringify(manifest({ id: "design/good", parent: "design/nowhere" })),
    });
  });
  const errors = (await checkCatalog(dir)).errors.join("\n");
  assert.match(errors, /duplicate id design\/good/);
  assert.match(errors, /parent design\/nowhere is not in the catalog/);
});

test("sources need a license, and a license-less source must be link-only", () => {
  const ok = { sources: [{ id: "a", kind: "github", repo: "x/y", commit: SHA, license: "MIT", dirs: [{ path: "p" }] }] };
  assert.deepEqual(checkSourcesDoc(ok), []);

  const noLicense = { sources: [{ id: "b", kind: "github", repo: "x/y", commit: SHA, license: "", dirs: [{ path: "p" }] }] };
  assert.ok(checkSourcesDoc(noLicense).some((e) => /no license/.test(e)));

  const noneButCopied = { sources: [{ id: "c", kind: "github", repo: "x/y", commit: SHA, license: "none", dirs: [{ path: "p" }] }] };
  assert.ok(checkSourcesDoc(noneButCopied).some((e) => /license none but kind is github/.test(e)));
});

test("the bundled catalog passes the check", async () => {
  const dir = path.resolve(HERE, "../../packages/analyzer/components");
  const result = await checkCatalog(dir);
  assert.deepEqual(result.errors, []);
  assert.ok(result.total < MAX_TOTAL_BYTES);
});

test("relative paths in SKILL.md are extracted; URLs, names and anchors are not", () => {
  const text = "See [craft](references/craft.md), `kit/lathe.mjs`, run node examples/x/build.mjs. " +
    "Visit https://a.com/b/c.md, localhost:8000/gpu.html, React/Next.js, and [top](#top).";
  assert.deepEqual(extractRelativeRefs(text), ["references/craft.md", "kit/lathe.mjs", "examples/x/build.mjs"]);
});

test("a SKILL.md path that is not in the component fails; one that is present passes", async () => {
  const dir = await fixture((root) =>
    writeComponent(root, "design", "good", {
      "SKILL.md": skill + "\nRead `references/present.md` first, then `kit/missing.mjs`.\n",
      LICENSE: "MIT\n",
      "component.json": JSON.stringify(manifest()),
      "references/present.md": "# present\n",
    }),
  );
  const errors = (await checkCatalog(dir)).errors.join("\n");
  assert.match(errors, /SKILL.md refers to kit\/missing.mjs, which is not in the component/);
  assert.doesNotMatch(errors, /present\.md/);
});

test("externalRefs allows a named path that is not bundled, and rejects a stale entry", async () => {
  const dir = await fixture((root) =>
    writeComponent(root, "design", "good", {
      "SKILL.md": skill + "\nRun `src/app.tsx` in your project.\n",
      LICENSE: "MIT\n",
      "component.json": JSON.stringify(manifest({ externalRefs: ["src/app.tsx"] })),
    }),
  );
  assert.deepEqual((await checkCatalog(dir)).errors, []);

  const stale = await fixture((root) =>
    writeComponent(root, "design", "good", {
      "SKILL.md": skill,
      LICENSE: "MIT\n",
      "component.json": JSON.stringify(manifest({ externalRefs: ["src/app.tsx"] })),
    }),
  );
  assert.ok((await checkCatalog(stale)).errors.some((e) => /externalRefs lists src\/app.tsx, which SKILL.md does not refer to/.test(e)));
});

test("a declared preamble must name a file that exists in the component", async () => {
  const missing = await fixture((root) =>
    writeComponent(root, "design", "good", {
      "SKILL.md": skill,
      LICENSE: "MIT\n",
      "component.json": JSON.stringify(manifest({ preamble: "SEQUENCE.md" })),
    }),
  );
  assert.ok((await checkCatalog(missing)).errors.some((e) => /preamble SEQUENCE.md is missing/.test(e)));

  const present = await fixture((root) =>
    writeComponent(root, "design", "good", {
      "SKILL.md": skill,
      LICENSE: "MIT\n",
      "SEQUENCE.md": "Sequence rules.\n",
      "component.json": JSON.stringify(manifest({ preamble: "SEQUENCE.md" })),
    }),
  );
  assert.deepEqual((await checkCatalog(present)).errors, []);
});
