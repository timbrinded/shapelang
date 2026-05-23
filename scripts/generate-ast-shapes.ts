#!/usr/bin/env bun
import { AST_SOURCE_EXTENSIONS } from "../packages/shp-checker/src/source-languages.ts";

const passthroughArgs = Bun.argv.slice(2);

const includePathspecs = AST_SOURCE_EXTENSIONS.map((extension) => `:(glob)**/*${extension}`);
const excludePathspecs = [
  ":(exclude)**/node_modules/**",
  ":(exclude)**/dist/**",
  ":(exclude)docs-site/.astro/**",
  ":(exclude)packages/shp-checker/src/language/generated/**",
  ":(exclude)shape/generated/**"
];

const sourceFiles = await trackedSourceFiles([...includePathspecs, ...excludePathspecs]);
const child = Bun.spawn(
  [
    "bun",
    "shp",
    "ast",
    "source",
    "--out-dir",
    "shape/generated/ast",
    ...passthroughArgs,
    ...sourceFiles
  ],
  {
    stdout: "inherit",
    stderr: "inherit"
  }
);

process.exit(await child.exited);

async function trackedSourceFiles(pathspecs: string[]): Promise<string[]> {
  const child = Bun.spawn(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...pathspecs],
    {
      stdout: "pipe",
      stderr: "inherit"
    }
  );
  const output = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
  return output
    .split("\0")
    .filter((path) => path.length > 0)
    .sort((left, right) => left.localeCompare(right));
}
