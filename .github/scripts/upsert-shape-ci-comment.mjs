import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SHAPE_CI_COMMENT_MARKER = "<!-- shape-ci-summary -->";
export const GITHUB_ACTIONS_BOT_LOGIN = "github-actions[bot]";

const REQUIRED_ENV = [
  "GITHUB_TOKEN",
  "HEAD_SHA",
  "PR_NUMBER",
  "REPOSITORY",
  "RUN_ID",
  "SERVER_URL",
  "SHAPE_CLAUDE_REVIEW_RESULT",
  "SHAPE_GUARD_RESULT",
  "SHAPE_INDEX_RESULT",
  "SHAPE_RESULT"
];

export function requireEnv(env = process.env, names = REQUIRED_ENV) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable ${missing.join(", ")}`);
  }
}

export function labelForWorkflowResult(result) {
  return (
    {
      success: "passed",
      failure: "failed",
      cancelled: "cancelled",
      skipped: "skipped"
    }[result] ?? result
  );
}

export function buildShapeCiComment(input) {
  const claudeJobResult = (result) =>
    input.claudeAvailable === "true"
      ? labelForWorkflowResult(result)
      : "skipped (no Claude credential)";
  const claudeReviewResult = claudeJobResult(input.shapeClaudeReviewResult);
  const guardResult = claudeJobResult(input.shapeGuardResult);
  const indexResult = claudeJobResult(input.shapeIndexResult);
  const shapeResult = labelForWorkflowResult(input.shapeResult);
  const claudeJobsOk =
    input.claudeAvailable !== "true" ||
    (input.shapeClaudeReviewResult === "success" &&
      input.shapeGuardResult === "success" &&
      input.shapeIndexResult === "success");
  const overall = input.shapeResult === "success" && claudeJobsOk ? "passed" : "needs attention";
  const runUrl = `${input.serverUrl}/${input.repository}/actions/runs/${input.runId}`;
  const shortSha = input.headSha.slice(0, 7);

  return [
    SHAPE_CI_COMMENT_MARKER,
    "## Shape CI Summary",
    "",
    `Overall: ${overall}`,
    "",
    "| Check | Result |",
    "| --- | --- |",
    `| Shape (\`bun run shape:ci\`) | ${shapeResult} |`,
    `| Shape Claude Review | ${claudeReviewResult} |`,
    `| Shape Contract Guard | ${guardResult} |`,
    `| Shape Index Coverage | ${indexResult} |`,
    "",
    `Commit: \`${shortSha}\``,
    `Workflow run: [${input.runId}](${runUrl})`,
    "",
    "This comment is updated on each PR run."
  ].join("\n");
}

export function commentWasWrittenByActionsBot(comment) {
  return comment?.user?.login === GITHUB_ACTIONS_BOT_LOGIN;
}

export function selectExistingShapeCiComment(comments) {
  return comments.find(
    (comment) =>
      commentWasWrittenByActionsBot(comment) && comment.body?.includes(SHAPE_CI_COMMENT_MARKER)
  );
}

export function parseRepository(repository) {
  const [owner, repo, ...rest] = repository.split("/");
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`Invalid REPOSITORY value ${repository}`);
  }
  return { owner, repo };
}

export function commentInputFromEnv(env = process.env) {
  requireEnv(env);
  return {
    githubToken: env.GITHUB_TOKEN,
    headSha: env.HEAD_SHA,
    prNumber: env.PR_NUMBER,
    repository: env.REPOSITORY,
    runId: env.RUN_ID,
    serverUrl: env.SERVER_URL,
    shapeClaudeReviewResult: env.SHAPE_CLAUDE_REVIEW_RESULT,
    shapeGuardResult: env.SHAPE_GUARD_RESULT,
    shapeIndexResult: env.SHAPE_INDEX_RESULT,
    shapeResult: env.SHAPE_RESULT,
    claudeAvailable: env.CLAUDE_AVAILABLE ?? "false"
  };
}

export function createGitHubClient({
  token,
  apiBase = "https://api.github.com",
  fetchImpl = fetch
}) {
  return async (path, options = {}) => {
    const headers = {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers
    };
    const response = await fetchImpl(`${apiBase}${path}`, {
      ...options,
      headers
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${options.method ?? "GET"} ${path} failed: ${response.status} ${text}`);
    }
    return response.status === 204 ? undefined : response.json();
  };
}

export async function listIssueComments(request, owner, repo, issueNumber) {
  const comments = [];
  for (let page = 1; ; page += 1) {
    const batch = await request(
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`
    );
    if (!Array.isArray(batch)) {
      throw new Error("GitHub comments response must be an array");
    }
    comments.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }
  return comments;
}

export async function upsertShapeCiComment(request, input) {
  const { owner, repo } = parseRepository(input.repository);
  const body = buildShapeCiComment(input);
  const comments = await listIssueComments(request, owner, repo, input.prNumber);
  const existing = selectExistingShapeCiComment(comments);

  if (existing) {
    await request(`/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ body })
    });
    return { action: "updated", id: existing.id, body };
  }

  const created = await request(`/repos/${owner}/${repo}/issues/${input.prNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body })
  });
  return { action: "created", id: created?.id, body };
}

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

if (isMainModule()) {
  const input = commentInputFromEnv();
  const request = createGitHubClient({ token: input.githubToken });
  upsertShapeCiComment(request, input).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
