const marker = "<!-- shape-ci-summary -->";

const requiredEnv = [
  "GITHUB_TOKEN",
  "HEAD_SHA",
  "PR_NUMBER",
  "REPOSITORY",
  "RUN_ID",
  "SERVER_URL",
  "SHAPE_CLAUDE_REVIEW_RESULT",
  "SHAPE_RESULT"
];

for (const name of requiredEnv) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable ${name}`);
  }
}

const labelFor = (result) =>
  ({
    success: "passed",
    failure: "failed",
    cancelled: "cancelled",
    skipped: "skipped"
  })[result] ?? result;

const request = async (path, options = {}) => {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28",
      ...options.headers
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${options.method ?? "GET"} ${path} failed: ${response.status} ${text}`);
  }
  return response.status === 204 ? undefined : response.json();
};

const [owner, repo] = process.env.REPOSITORY.split("/");
const prNumber = process.env.PR_NUMBER;
const claudeReviewResult =
  process.env.CLAUDE_AVAILABLE === "true"
    ? labelFor(process.env.SHAPE_CLAUDE_REVIEW_RESULT)
    : "skipped (no Claude credential)";
const shapeResult = labelFor(process.env.SHAPE_RESULT);
const overall =
  process.env.SHAPE_RESULT === "success" &&
  (process.env.CLAUDE_AVAILABLE !== "true" || process.env.SHAPE_CLAUDE_REVIEW_RESULT === "success")
    ? "passed"
    : "needs attention";

const runUrl = `${process.env.SERVER_URL}/${process.env.REPOSITORY}/actions/runs/${process.env.RUN_ID}`;
const shortSha = process.env.HEAD_SHA.slice(0, 7);
const body = [
  marker,
  "## Shape CI Summary",
  "",
  `Overall: ${overall}`,
  "",
  "| Check | Result |",
  "| --- | --- |",
  `| Shape (\`bun run shape:ci\`) | ${shapeResult} |`,
  `| Shape Claude Review | ${claudeReviewResult} |`,
  "",
  `Commit: \`${shortSha}\``,
  `Workflow run: [${process.env.RUN_ID}](${runUrl})`,
  "",
  "This comment is updated on each PR run."
].join("\n");

const comments = [];
for (let page = 1; ; page += 1) {
  const batch = await request(
    `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`
  );
  comments.push(...batch);
  if (batch.length < 100) {
    break;
  }
}

const existing = comments.find((comment) => comment.body?.includes(marker));
if (existing) {
  await request(`/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
    method: "PATCH",
    body: JSON.stringify({ body })
  });
} else {
  await request(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body })
  });
}
