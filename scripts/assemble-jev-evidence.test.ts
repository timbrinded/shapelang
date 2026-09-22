import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assembleEvidence } from "./assemble-jev-evidence.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

function git(repoRoot: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function write(repoRoot: string, path: string, content: string) {
  await mkdir(dirname(join(repoRoot, path)), { recursive: true });
  await Bun.write(join(repoRoot, path), content);
}

function commit(repoRoot: string): string {
  git(repoRoot, "add", ".");
  git(repoRoot, "commit", "-qm", "fixture");
  return git(repoRoot, "rev-parse", "HEAD");
}

async function fixture(options: { path?: string; anchor?: boolean; padding?: string } = {}) {
  const repoRoot = await mkdtemp(join(tmpdir(), "shape-jev-evidence-"));
  directories.push(repoRoot);
  git(repoRoot, "init", "-q");
  git(repoRoot, "config", "user.email", "fixture@example.invalid");
  git(repoRoot, "config", "user.name", "Fixture");
  git(repoRoot, "config", "commit.gpgsign", "false");
  const path = options.path ?? "src/audit.ts";
  const initial = `export function record(db, value) { db.append(value); }\n${options.padding ?? ""}`;
  await write(repoRoot, path, initial);
  await write(
    repoRoot,
    "shape/app.shape",
    `module app
import journal.store
component Audit {
  grants Append<Journal>
  fn record
    ${options.anchor === false ? "" : `source ts(${JSON.stringify(`${path}#record`)})`}
    effects complete { Append<Journal> }
}
component Unrelated { }
implementation Sources {
  paths { "src/**" }
  on_change require shape_update
}
memory KeepAppend : RefactorConstraint<component Audit> {
  summary "Keep the journal append-only."
}
relation AuditWrites {
  kind calls
  connects Audit -> Store
}
`
  );
  await write(
    repoRoot,
    "shape/storage.shape",
    `module journal.store
resource Journal : AppendOnly
component Store { grants Append<Journal> }
`
  );
  const base = commit(repoRoot);
  await write(repoRoot, path, initial.replaceAll("value", "entry"));
  const head = commit(repoRoot);
  return {
    repoRoot,
    path,
    transition: { base, head },
    obligation: {
      id: `shp-obligation-${"a".repeat(64)}`,
      type: "shape-change-or-attestation" as const,
      message: "Implementation source changed.",
      paths: [path]
    }
  };
}

test("assembles an exact committed rename, authored dependencies and accepted claim without agent context", async () => {
  const options = await fixture();
  const attestation = {
    kind: "no-shape-change" as const,
    rationale: "Only the local parameter name changes."
  };
  await write(options.repoRoot, options.path, "uncommitted content must not enter evidence");
  const evidence = await assembleEvidence({ ...options, attestation });
  expect(evidence.attestation).toEqual(attestation);
  const patch = evidence.diff.files[0]?.patch ?? "";
  expect(patch).toContain("db.append(value)");
  expect(patch).toContain("db.append(entry)");
  expect(patch).not.toContain("uncommitted content");
  const context = evidence.shapeContext.declarations.join("\n");
  expect(context).toContain("component Audit");
  expect(context).toContain("resource Journal : AppendOnly");
  expect(context).toContain("component Store");
  expect(context).toContain("memory KeepAppend");
  expect(context).toContain("relation AuditWrites");
  expect(context).not.toContain("component Unrelated");
  expect(context).toContain(options.transition.base);
  expect(context).toContain(options.transition.head);
  expect(await assembleEvidence({ ...options, attestation })).toEqual(evidence);
});

test("destructive source change retains the contradictory append-only claim and built-in final forbids", async () => {
  const options = await fixture();
  await write(
    options.repoRoot,
    options.path,
    "export function record(db, entry) { db.deleteAll(); }\n"
  );
  options.transition.head = commit(options.repoRoot);
  const evidence = await assembleEvidence({
    ...options,
    attestation: { kind: "no-shape-change", rationale: "Purely cosmetic." }
  });
  expect(evidence.diff.files[0]?.patch).toContain("db.deleteAll()");
  expect(evidence.shapeContext.declarations.join("\n")).toContain("AppendOnly");
  expect(evidence.shapeContext.annotations.join("\n")).toContain("HardDelete");
  expect(evidence.attestation?.rationale).toBe("Purely cosmetic.");
});

test("uses literal Git paths when a filename resembles a glob", async () => {
  const options = await fixture({ path: "src/[ab].ts" });
  await write(options.repoRoot, "src/a.ts", "unrelated changed file sentinel\n");
  options.transition.head = commit(options.repoRoot);
  const evidence = await assembleEvidence(options);
  expect(evidence.diff.files[0]?.patch).toContain("src/[ab].ts");
  expect(evidence.diff.files[0]?.patch).not.toContain("unrelated changed file sentinel");
});

test("rejects obligations without source-anchored authored architecture", async () => {
  await expect(assembleEvidence(await fixture({ anchor: false }))).rejects.toMatchObject({
    code: "invalid_evidence",
    message: expect.stringContaining("No authored function source/effect anchor")
  });
});

test("rejects oversized evidence instead of trimming complete source or policies", async () => {
  await expect(
    assembleEvidence(await fixture({ padding: `// ${"x".repeat(35000)}\n` }))
  ).rejects.toMatchObject({
    code: "invalid_evidence",
    message: expect.stringContaining("64 KiB")
  });
});

test("rejects a stale checkout, malformed commits, unchanged paths and parent traversal", async () => {
  const options = await fixture();
  await expect(
    assembleEvidence({ ...options, transition: { ...options.transition, base: "HEAD~1" } })
  ).rejects.toMatchObject({ code: "invalid_evidence" });
  await expect(
    assembleEvidence({
      ...options,
      obligation: { ...options.obligation, paths: ["../outside.ts"] }
    })
  ).rejects.toMatchObject({ code: "invalid_evidence" });
  await expect(
    assembleEvidence({
      ...options,
      transition: { base: options.transition.head, head: options.transition.head }
    })
  ).rejects.toMatchObject({
    code: "invalid_evidence",
    message: expect.stringContaining("no change")
  });
  git(options.repoRoot, "checkout", "-q", options.transition.base);
  await expect(assembleEvidence(options)).rejects.toMatchObject({
    code: "invalid_evidence",
    message: expect.stringContaining("Check out")
  });
});

test("rejects ambiguous authored symbols", async () => {
  const options = await fixture();
  await write(options.repoRoot, "shape/duplicate.shape", "module app\ncomponent Audit {}\n");
  options.transition.head = commit(options.repoRoot);
  await expect(assembleEvidence(options)).rejects.toMatchObject({
    code: "invalid_evidence",
    message: expect.stringContaining("invalid or ambiguous")
  });
});
