import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { checkPullRequest } from "../../../scripts/check-pr.ts";
import { renderCheckReport } from "../../../scripts/report-pr-check.ts";
import { extractAttestations, replaceAttestations } from "../../../scripts/pr-attestations.ts";

const cli = resolve(import.meta.dir, "index.ts");
test("transition default discovery rejects wholly and partially omitted sparse models", async () => {
  const root = await mkdtemp(join(tmpdir(), "shp-pr-sparse-"));
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const run = (base: string, ...files: string[]) => {
    const result = spawnSync(process.execPath, [cli, "check", "--json", "--base", base, ...files], {
      cwd: root,
      encoding: "utf8"
    });
    expect(result.stderr).toBe("");
    return { status: result.status, data: JSON.parse(result.stdout) };
  };
  try {
    git("init", "-q");
    git("config", "user.email", "tests@example.com");
    git("config", "user.name", "Tests");
    git("config", "commit.gpgsign", "false");
    await mkdir(join(root, "shape", "visible"), { recursive: true });
    await mkdir(join(root, "shape", "policy"), { recursive: true });
    await mkdir(join(root, "shape", ".hidden"), { recursive: true });
    await mkdir(join(root, "src"));
    await writeFile(join(root, "shapelang.json"), '{"attestations":{"mode":"pr"}}');
    await writeFile(join(root, "shape", "visible", "app.shape"), "module app\n");
    // Hidden paths are deliberately outside ordinary default discovery.
    await writeFile(join(root, "shape", ".hidden", "ignored.shape"), "invalid Shape !\n");
    await writeFile(join(root, "shape", ".ignored.shape"), "invalid Shape !\n");
    await writeFile(
      join(root, "shape", "policy", "coverage.shape"),
      'module governance\nimplementation App { paths { "src/**" } on_change require shape_update }\n'
    );
    await writeFile(join(root, "src", "app.ts"), "export const x = 1;\n");
    git("add", ".");
    git("commit", "-qm", "baseline");
    const base = git("rev-parse", "HEAD");
    await writeFile(join(root, "src", "app.ts"), "export const x = 2;\n");
    git("add", ".");
    git("commit", "-qm", "candidate");
    const complete = run(base);
    expect(complete).toMatchObject({ status: 1 });
    expect(complete.data.obligations).toHaveLength(1);

    for (const directories of [["src"], ["src", "shape/visible"]]) {
      git("sparse-checkout", "set", "--cone", ...directories);
      expect(git("status", "--porcelain")).toBe("");
      const omitted = run(base);
      expect(omitted.status).toBe(2);
      expect(omitted.data.diagnostics[0].kind).toBe("check_input_error");
      expect(omitted.data.diagnostics[0].message).toContain("shape/policy/coverage.shape");
    }
    // Explicit file selection continues to check exactly the requested model.
    expect(run(base, "shape/visible/app.shape").status).toBe(0);
    git("sparse-checkout", "disable");
    expect(run(base)).toEqual(complete);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test("real Git/CLI/PR-body workflow: missing -> accepted -> stale, and parser errors stay fatal", async () => {
  const root = await mkdtemp(join(tmpdir(), "shp-pr-e2e-"));
  const artifacts = await mkdtemp(join(tmpdir(), "shp-pr-evidence-"));
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [cli, "check", "--json", ...args], {
      cwd: root,
      encoding: "utf8"
    });
    expect(result.stderr).toBe("");
    return { status: result.status, data: JSON.parse(result.stdout) };
  };
  try {
    git("init", "-q");
    git("config", "user.email", "tests@example.com");
    git("config", "user.name", "Tests");
    await mkdir(join(root, "shape"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "shapelang.json"), '{"attestations":{"mode":"pr"}}');
    await writeFile(
      join(root, "shape/app.shape"),
      'module app\nimplementation App { paths { "src/**" } on_change require shape_update }\n'
    );
    await writeFile(join(root, "src/app.ts"), "export const x = 1;\n");
    git("add", ".");
    git("commit", "-qm", "baseline");
    const base = git("rev-parse", "HEAD");
    await writeFile(join(root, "src/app.ts"), "export const y = 1;\n");
    git("add", ".");
    git("commit", "-qm", "rename");
    const head = git("rev-parse", "HEAD");
    const missing = run("--base", base, "--head", head);
    expect(missing.status).toBe(1);
    expect(missing.data.transition).toEqual({ base, head });
    expect(missing.data.obligations).toHaveLength(1);
    expect(run("--base", base, "--worktree").data).toEqual(missing.data);
    const bundle = {
      version: 1,
      base,
      head,
      attestations: [
        {
          obligation: missing.data.obligations[0].id,
          kind: "no-shape-change",
          rationale: "Local rename"
        }
      ]
    };
    const body = replaceAttestations("PR description", bundle);
    const oldCwd = process.cwd();
    try {
      process.chdir(root);
      const workflow = { base, head, outputDirectory: artifacts, command: [process.execPath, cli] };
      expect(await checkPullRequest({ ...workflow, body: "No evidence" })).toBe(1);
      expect(
        renderCheckReport(await Bun.file(join(artifacts, "check.json")).json(), 1).annotations
      ).toHaveLength(1);
      expect(await checkPullRequest({ ...workflow, body })).toBe(0);
      const report = await Bun.file(join(artifacts, "check.json")).json();
      expect(report.ok).toBe(true);
      expect(renderCheckReport(report, 0).annotations).toEqual([]);
      expect(await checkPullRequest({ ...workflow, body: "Evidence removed" })).toBe(1);
      expect(await Bun.file(join(artifacts, "attestations.json")).exists()).toBe(false);
      expect(await checkPullRequest({ ...workflow, body: body + body })).toBe(1);
    } finally {
      process.chdir(oldCwd);
    }
    const evidenceFile = join(artifacts, "bundle.json");
    await writeFile(evidenceFile, JSON.stringify(extractAttestations(body)));
    expect(run("--base", base, "--attestations", evidenceFile).status).toBe(0);
    // A new commit invalidates even evidence for an otherwise unchanged obligation.
    await writeFile(join(root, "README.md"), "new docs\n");
    git("add", ".");
    git("commit", "-qm", "docs");
    const stale = run("--base", base, "--attestations", evidenceFile);
    expect(stale.status).toBe(1);
    expect(renderCheckReport(stale.data, 1).text).toContain("attestation stale");
    expect(stale.data.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "attestation_error", code: "stale" })
    );
    // Checkout mismatch, input ambiguity and dirty worktrees must not claim exact commit coverage.
    expect(run("--base", base, "--head", head).status).toBe(2);
    expect(run("--base", base, "--changed-files", "list.txt").status).toBe(2);
    await writeFile(join(root, "src/app.ts"), "unstaged\n");
    expect(run("--base", base).status).toBe(2);
    git("add", ".");
    expect(run("--base", base, "--worktree").status).toBe(2);
    git("commit", "-qm", "staged change");
    await writeFile(join(root, "untracked.ts"), "untracked\n");
    expect(run("--base", base).status).toBe(2);
    await rm(join(root, "untracked.ts"));
    await writeFile(join(root, ".git/info/exclude"), "shape/ignored.shape\n");
    await writeFile(join(root, "shape/ignored.shape"), "module extra\n");
    expect(run("--base", base).status).toBe(2);
    await rm(join(root, "shape/ignored.shape"));
    await writeFile(join(root, "shape/app.shape"), "invalid Shape !\n");
    git("add", ".");
    git("commit", "-qm", "invalid model");
    const parseError = run("--base", base, "--attestations", evidenceFile);
    expect(parseError.status).toBe(2);
    expect(parseError.data.diagnostics[0].kind).toBe("parse");
    await writeFile(evidenceFile, "{");
    expect(run("--base", base, "--attestations", evidenceFile).data.diagnostics[0].code).toBe(
      "malformed"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(artifacts, { recursive: true, force: true });
  }
}, 30_000);
