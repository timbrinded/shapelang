import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

export const SKILLS_RELEASE_APPROVAL_ENVIRONMENT = "skills-release-approval";

/**
 * Paths that invalidate reuse of an ancestor skills-release report.
 * Keep this fail-closed: a docs-only commit may reuse; a CLI, skill, fixture,
 * or release-gate commit must not.
 */
export const SKILLS_RELEVANT_PATH_PREFIXES = [
  "plugins/shapelang/",
  "packages/",
  "fixtures/",
  ".github/prompts/",
  ".github/scripts/",
  ".github/actions/",
  ".github/shape-contract/",
  ".github/workflows/release-candidate.yml",
  ".github/workflows/release.yml",
  "scripts/",
  "package.json",
  "bun.lock",
  "action.yml",
  "install.sh",
  "install.ps1"
] as const;

export type WorkflowRun = {
  id: number;
  run_number: number;
  head_sha: string;
  head_branch: string;
  conclusion: string | null;
};

export type EnvironmentApproval = {
  state: string;
  environments?: Array<{ name?: string }>;
};

export type ApprovalLookup = {
  tagSha: string;
  masterSha: string;
  pluginSha: string;
  runs: WorkflowRun[];
  approvalsForRun: (runId: number) => EnvironmentApproval[];
  isAncestor: (sha: string, of: string) => boolean;
  changedPaths: (fromSha: string, toSha: string) => string[];
};

export type ReusableSkillsApproval = {
  run: WorkflowRun;
  mode: "exact" | "ancestor";
};

export function isSkillsRelevantPath(path: string): boolean {
  return SKILLS_RELEVANT_PATH_PREFIXES.some((prefix) => {
    if (prefix.endsWith("/")) {
      return path === prefix.slice(0, -1) || path.startsWith(prefix);
    }
    return path === prefix;
  });
}

export function skillsRelevantChanges(paths: readonly string[]): string[] {
  return [...new Set(paths.filter(isSkillsRelevantPath))].sort();
}

export function peelGitObjectSha(
  ref: { object?: { sha?: unknown; type?: unknown } },
  taggedObject?: { object?: { sha?: unknown; type?: unknown } }
): string {
  const object = ref.object;
  if (!object || typeof object.sha !== "string" || typeof object.type !== "string") {
    throw new Error("Git ref payload is missing object.sha/object.type");
  }
  if (object.type === "commit") {
    return object.sha;
  }
  if (object.type === "tag") {
    const peeled = taggedObject?.object;
    if (!peeled || typeof peeled.sha !== "string" || peeled.type !== "commit") {
      throw new Error(`Annotated tag ${object.sha} did not peel to a commit`);
    }
    return peeled.sha;
  }
  throw new Error(`Unsupported git object type "${object.type}"`);
}

export function runHasSkillsApproval(approvals: readonly EnvironmentApproval[]): boolean {
  return approvals.some(
    (approval) =>
      approval.state === "approved" &&
      (approval.environments ?? []).some(
        (environment) => environment.name === SKILLS_RELEASE_APPROVAL_ENVIRONMENT
      )
  );
}

function maxByRunNumber(runs: WorkflowRun[]): WorkflowRun | undefined {
  if (runs.length === 0) {
    return undefined;
  }
  return runs.reduce((latest, run) => (run.run_number > latest.run_number ? run : latest));
}

function successfulMasterRuns(runs: readonly WorkflowRun[]): WorkflowRun[] {
  return runs.filter(
    (run) => run.head_branch === "master" && run.conclusion === "success" && Number.isFinite(run.id)
  );
}

export function findExactApprovedCandidate(lookup: ApprovalLookup): WorkflowRun {
  if (lookup.tagSha !== lookup.masterSha) {
    throw new Error(
      `Release tag commit ${lookup.tagSha} is not current master ${lookup.masterSha}.`
    );
  }
  if (lookup.pluginSha !== lookup.tagSha) {
    throw new Error(
      `Plugin tag resolves to ${lookup.pluginSha}, not release commit ${lookup.tagSha}.`
    );
  }

  const matches = successfulMasterRuns(lookup.runs).filter(
    (run) => run.head_sha === lookup.tagSha && runHasSkillsApproval(lookup.approvalsForRun(run.id))
  );
  const selected = maxByRunNumber(matches);
  if (!selected) {
    throw new Error(
      `No successful, manually approved Release Candidate: Skills run exists for ${lookup.tagSha}.`
    );
  }
  return selected;
}

export function findReusableSkillsApproval(
  lookup: Pick<
    ApprovalLookup,
    "tagSha" | "runs" | "approvalsForRun" | "isAncestor" | "changedPaths"
  >
): ReusableSkillsApproval | undefined {
  const approved = successfulMasterRuns(lookup.runs).filter((run) =>
    runHasSkillsApproval(lookup.approvalsForRun(run.id))
  );

  const exact = maxByRunNumber(approved.filter((run) => run.head_sha === lookup.tagSha));
  if (exact) {
    return { run: exact, mode: "exact" };
  }

  const ancestors = approved.filter((run) => {
    if (!lookup.isAncestor(run.head_sha, lookup.tagSha)) {
      return false;
    }
    return skillsRelevantChanges(lookup.changedPaths(run.head_sha, lookup.tagSha)).length === 0;
  });
  const selected = maxByRunNumber(ancestors);
  if (!selected) {
    return undefined;
  }
  return { run: selected, mode: "ancestor" };
}

export function amendReusedSkillsReport(
  report: Record<string, unknown>,
  reuse: ReusableSkillsApproval
): Record<string, unknown> {
  const summary = typeof report.summary === "string" ? report.summary.trim() : "";
  const prefix = `Reused approved skills evaluation from ${reuse.run.head_sha} (run ${reuse.run.id}, ${reuse.mode}). Skills-relevant tree is unchanged on this commit.`;
  return {
    ...report,
    summary: summary.length > 0 ? `${prefix} ${summary}` : prefix
  };
}

type GhJson = (path: string) => unknown;

function spawnGh(args: string[], options?: { cwd?: string }): string {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20_000_000,
    cwd: options?.cwd
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `gh ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function defaultGetJson(path: string): unknown {
  return JSON.parse(spawnGh(["api", path]));
}

function listCandidateRuns(getJson: GhJson, repo: string): WorkflowRun[] {
  const runs: WorkflowRun[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const payload = getJson(
      `repos/${repo}/actions/workflows/release-candidate.yml/runs?branch=master&event=workflow_dispatch&status=completed&per_page=100&page=${page}`
    );
    if (typeof payload !== "object" || payload === null || !("workflow_runs" in payload)) {
      throw new Error("Release-candidate run list is missing workflow_runs");
    }
    const pageRuns = (payload as { workflow_runs: unknown }).workflow_runs;
    if (!Array.isArray(pageRuns)) {
      throw new Error("Release-candidate run list workflow_runs is not an array");
    }
    for (const run of pageRuns) {
      if (typeof run !== "object" || run === null) {
        continue;
      }
      const record = run as Record<string, unknown>;
      if (
        typeof record.id !== "number" ||
        typeof record.run_number !== "number" ||
        typeof record.head_sha !== "string" ||
        typeof record.head_branch !== "string"
      ) {
        continue;
      }
      runs.push({
        id: record.id,
        run_number: record.run_number,
        head_sha: record.head_sha,
        head_branch: record.head_branch,
        conclusion: typeof record.conclusion === "string" ? record.conclusion : null
      });
    }
    if (pageRuns.length < 100) {
      break;
    }
  }
  return runs;
}

function resolveRefCommit(getJson: GhJson, repo: string, ref: string): string {
  const payload = getJson(`repos/${repo}/git/ref/${ref}`);
  const object =
    typeof payload === "object" && payload !== null
      ? (payload as { object?: { sha?: unknown; type?: unknown } })
      : {};
  if (object.object?.type === "tag" && typeof object.object.sha === "string") {
    const tagged = getJson(`repos/${repo}/git/tags/${object.object.sha}`);
    return peelGitObjectSha(object, tagged as { object?: { sha?: unknown; type?: unknown } });
  }
  return peelGitObjectSha(object);
}

function gitIsAncestor(ancestor: string, descendant: string): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    encoding: "utf8"
  });
  return result.status === 0;
}

function gitChangedPaths(fromSha: string, toSha: string): string[] {
  const result = spawnSync("git", ["diff", "--name-only", fromSha, toSha], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git diff ${fromSha} ${toSha} failed`);
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readSkillsReport(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Skills report is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function downloadSkillsReport(run: WorkflowRun): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), "shape-skills-reuse-"));
  try {
    spawnGh(
      [
        "run",
        "download",
        String(run.id),
        "--name",
        `skill-release-report-${run.head_sha}`,
        "--dir",
        dir
      ],
      { cwd: dir }
    );
    return readSkillsReport(readFileSync(join(dir, "skill-release-result.json"), "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      "require-exact": { type: "boolean", default: false },
      "reuse-if-eligible": { type: "boolean", default: false },
      json: { type: "boolean", default: false }
    },
    strict: true
  });

  if (values["require-exact"] === values["reuse-if-eligible"]) {
    throw new Error("Choose exactly one of --require-exact or --reuse-if-eligible");
  }

  const repo = requireEnv("GITHUB_REPOSITORY");
  const sha = requireEnv("GITHUB_SHA");
  const getJson: GhJson = defaultGetJson;
  const runs = listCandidateRuns(getJson, repo);

  if (values["require-exact"]) {
    const refName = requireEnv("GITHUB_REF_NAME");
    const masterSha = resolveRefCommit(getJson, repo, "heads/master");
    const pluginSha = resolveRefCommit(getJson, repo, `tags/shapelang--${refName}`);
    const selected = findExactApprovedCandidate({
      tagSha: sha,
      masterSha,
      pluginSha,
      runs,
      approvalsForRun: (runId) => {
        const payload = getJson(`repos/${repo}/actions/runs/${runId}/approvals`);
        return Array.isArray(payload) ? (payload as EnvironmentApproval[]) : [];
      },
      isAncestor: gitIsAncestor,
      changedPaths: gitChangedPaths
    });
    console.log(
      `Approved release candidate run ${selected.id} for ${sha} (plugin tag shapelang--${refName}).`
    );
    return;
  }

  const approvalsCache = new Map<number, EnvironmentApproval[]>();
  const reuse = findReusableSkillsApproval({
    tagSha: sha,
    runs,
    approvalsForRun: (runId) => {
      const cached = approvalsCache.get(runId);
      if (cached) {
        return cached;
      }
      const payload = getJson(`repos/${repo}/actions/runs/${runId}/approvals`);
      const approvals = Array.isArray(payload) ? (payload as EnvironmentApproval[]) : [];
      approvalsCache.set(runId, approvals);
      return approvals;
    },
    isAncestor: gitIsAncestor,
    changedPaths: gitChangedPaths
  });

  if (!reuse) {
    const payload = { reused: false };
    console.log(JSON.stringify(payload));
    return;
  }

  const report = amendReusedSkillsReport(downloadSkillsReport(reuse.run), reuse);
  console.log(
    JSON.stringify({
      reused: true,
      mode: reuse.mode,
      sha: reuse.run.head_sha,
      runId: reuse.run.id,
      report
    })
  );
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
