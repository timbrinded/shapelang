/** Reference orchestration; GitHub knowledge stays outside shp. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "../packages/shp-checker/src/attestations.ts";
import { extractAttestations } from "./pr-attestations.ts";

export async function checkPullRequest(options: {
  base: string;
  head: string;
  body: string;
  outputDirectory: string;
  command: string[];
}): Promise<number> {
  await mkdir(options.outputDirectory, { recursive: true });
  const initialPath = join(options.outputDirectory, "deterministic.json");
  const finalPath = join(options.outputDirectory, "check.json");
  const run = async (extra: string[]) => {
    const child = Bun.spawn(
      [
        ...options.command,
        "check",
        "--json",
        "--base",
        options.base,
        "--head",
        options.head,
        ...extra
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited
    ]);
    if (stderr) process.stderr.write(stderr);
    // A crash or unsupported CLI is never a pass or an empty obligation set.
    const result: unknown = JSON.parse(stdout);
    return { status, text: JSON.stringify(result, null, 2) + "\n" };
  };
  const initial = await run([]);
  await Bun.write(initialPath, initial.text);
  try {
    const bundle = extractAttestations(options.body);
    if (!bundle) {
      await Bun.write(finalPath, initial.text);
      return initial.status;
    }
    const bundlePath = join(options.outputDirectory, "attestations.json");
    await Bun.write(bundlePath, JSON.stringify(bundle));
    const final = await run(["--attestations", bundlePath]);
    await Bun.write(finalPath, final.text);
    return final.status;
  } catch (error) {
    await Bun.write(
      finalPath,
      JSON.stringify(
        {
          ok: false,
          exitCode: 1,
          diagnostics: [
            {
              kind: "pr_attestation_error",
              message: error instanceof Error ? error.message : String(error)
            }
          ]
        },
        null,
        2
      ) + "\n"
    );
    return 1;
  }
}
if (import.meta.main) {
  const {
    GITHUB_REPOSITORY: repository,
    PR_NUMBER: number,
    GITHUB_TOKEN: token,
    PR_BASE: base,
    PR_HEAD: head,
    SHAPE_OUTPUT_DIR: outputDirectory
  } = process.env;
  if (!repository || !number || !base || !head || !outputDirectory)
    throw new Error("Missing PR context.");
  const response = await fetch(`https://api.github.com/repos/${repository}/pulls/${number}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Read PR failed: HTTP ${response.status}`);
  const pr = await response.json();
  if (
    !isRecord(pr) ||
    !isRecord(pr.base) ||
    !isRecord(pr.head) ||
    pr.base.sha !== base ||
    pr.head.sha !== head ||
    (pr.body !== null && typeof pr.body !== "string")
  )
    throw new Error(
      "PR base/head changed since this run was queued; rerun against the current transition."
    );
  process.exitCode = await checkPullRequest({
    base,
    head,
    body: typeof pr.body === "string" ? pr.body : "",
    outputDirectory,
    command: [process.execPath, "packages/shp-cli/src/index.ts"]
  });
}
