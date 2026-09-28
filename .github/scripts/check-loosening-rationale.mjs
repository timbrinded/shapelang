import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Every rule loosening that `bun run shape:loosening` reports must be explained
// in a visible "Rule loosening" section of the pull request body: one line that
// names the loosened declaration and says why.

const REASON_WORDS = 3;

/**
 * The edits named by each `error: rule loosening` report in shp check output.
 * A joint report lists several edits; each one needs its own reason.
 */
export function looseningEdits(log) {
  const lines = log.split(/\r?\n/);
  const edits = new Map();
  lines.forEach((line, index) => {
    if (line !== "error: rule loosening") {
      return;
    }
    const sentence = lines.slice(index + 1).find((next) => next.startsWith("This change "));
    if (sentence === undefined) {
      return;
    }
    const parts = sentence
      .slice("This change ".length)
      .replace(/\.$/, "")
      .replace(/^makes these rule changes together: /, "")
      .split("; ");
    for (const edit of parts) {
      // The edited declaration is named last; a renamed resource adds its new name.
      const match = /(\S+)(?: \(renamed (\S+)\))?$/.exec(edit);
      edits.set(edit, { edit, names: [match?.[1], match?.[2]].filter(Boolean) });
    }
  });
  return [...edits.values()];
}

/** The body as GitHub shows it: HTML comments and collapsed details are hidden. */
function visibleMarkdown(body) {
  return body
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<details[\s\S]*?(?:<\/details>|$)/gi, "");
}

/** The visible text under the body's "Rule loosening" heading, if it has one. */
export function rationaleSection(body) {
  const lines = visibleMarkdown(body).split(/\r?\n/);
  const level = (line) => /^\s{0,3}(#{1,6})\s/.exec(line)?.[1]?.length;
  const start = lines.findIndex((line) => /^\s{0,3}#{1,6}\s+rule loosening\s*#*\s*$/i.test(line));
  if (start === -1) {
    return undefined;
  }
  const depth = level(lines[start]);
  const end = lines.findIndex((line, index) => index > start && level(line) <= depth);
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}

/** Edits that no line of the section both names and gives a reason for. */
export function unexplainedEdits(edits, section = "") {
  const lines = section.split("\n");
  return edits.filter(
    ({ names }) => !lines.some((line) => names.some((name) => explains(line, name)))
  );
}

function explains(line, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\w.])${escaped}(?!\\w)`);
  const reason = pattern.test(line) ? line.replace(pattern, " ") : "";
  return (reason.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []).length >= REASON_WORDS;
}

function main() {
  const edits = looseningEdits(readFileSync(process.argv[2] ?? "loosening.log", "utf8"));
  if (edits.length === 0) {
    console.log("No rule loosening.");
    return;
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));
  const section = rationaleSection(event.pull_request?.body ?? "");
  const unexplained = unexplainedEdits(edits, section);
  for (const { edit, names } of unexplained) {
    console.log(
      `::error title=Rule loosening without a reason::This change ${edit}. Restore the rule and change the code. If the maintainer asked for this loosening, add a line naming ${names[0]} and saying why to a visible "## Rule loosening" section of the pull request body.`
    );
  }
  if (unexplained.length > 0) {
    process.exit(1);
  }
  console.log("Every rule loosening has a reason in the pull request body.");
}

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

if (isMainModule()) {
  main();
}
