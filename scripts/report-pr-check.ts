/** Human presentation for the reference workflow; check.json remains authoritative. */
import { join } from "node:path";
import { formatDiagnostics, type ShapeDiagnostic } from "../packages/shp-checker/src/index.ts";
import { isRecord } from "../packages/shp-checker/src/attestations.ts";

function escapeData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function escapeProperty(value: string): string {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

export function renderCheckReport(result: unknown, status: number) {
  if (!isRecord(result) || typeof result.ok !== "boolean" || !Array.isArray(result.diagnostics)) {
    throw new Error(
      "Missing or invalid check.json; inspect the check step log for the checker failure."
    );
  }
  const passed = status === 0 && result.ok;
  const diagnostics = result.diagnostics.map((value: unknown) => {
    if (!isRecord(value) || typeof value.kind !== "string") {
      throw new Error("Invalid diagnostic in check.json.");
    }
    let text: string;
    try {
      // This artifact is produced by the bundled CLI. Reuse its canonical formatter;
      // wrapper errors and future diagnostic kinds retain a readable fallback.
      text = formatDiagnostics({
        ok: false,
        exitCode: 1,
        diagnostics: [value as ShapeDiagnostic]
      }).trim();
    } catch {
      text = "";
    }
    if (!text) {
      text = `error: ${value.kind.replaceAll("_", " ")}\n\n${typeof value.message === "string" ? value.message : JSON.stringify(value, null, 2)}`;
    }
    const severity = value.severity === "warning" ? "warning" : "error";
    const title = text.split("\n")[0]!.replace(/^(error|warning): /, "");
    const properties = [`title=${escapeProperty(`Shape: ${title}`)}`];
    const file = typeof value.changedFile === "string" ? value.changedFile : value.filePath;
    if (typeof file === "string" && file) {
      properties.push(`file=${escapeProperty(file)}`);
      // Line/column belong to filePath, never to a different changed source file.
      if (file === value.filePath && Number.isInteger(value.line) && Number(value.line) > 0) {
        properties.push(`line=${value.line}`);
        if (Number.isInteger(value.column) && Number(value.column) > 0)
          properties.push(`col=${value.column}`);
      }
    }
    return { text, annotation: `::${severity} ${properties.join(",")}::${escapeData(text)}` };
  });
  if (!passed && diagnostics.length === 0) {
    diagnostics.push({
      text: `error: Shape check failed (exit ${status}) without diagnostics. Inspect the check step log.`,
      annotation:
        "::error title=Shape check failed::No diagnostics were produced; inspect the check step log."
    });
  }
  const heading = `Shape deterministic check: ${passed ? "passed" : "failed"}`;
  const text = [heading, ...diagnostics.map((diagnostic) => diagnostic.text)].join("\n\n") + "\n";
  // A longer fence keeps diagnostic content literal, including hostile filenames.
  const fence = "`".repeat(
    Math.max(3, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length + 1))
  );
  const markdown = `## ${heading}\n\n${fence}text\n${text}${fence}\n\nFull machine-readable results: \`check.json\` in the Shape enforcement artifact.\n`;
  return { text, markdown, annotations: diagnostics.map((diagnostic) => diagnostic.annotation) };
}

if (import.meta.main) {
  const directory = process.env.SHAPE_OUTPUT_DIR;
  if (!directory) throw new Error("Missing SHAPE_OUTPUT_DIR.");
  const status = Number(process.argv[2]);
  let report;
  try {
    if (!Number.isInteger(status) || status < 0) throw new Error("Missing checker exit status.");
    report = renderCheckReport(await Bun.file(join(directory, "check.json")).json(), status);
  } catch (error) {
    report = renderCheckReport(
      { ok: false, diagnostics: [{ kind: "pr_check_report_error", message: String(error) }] },
      1
    );
    process.exitCode = 1;
  }
  await Bun.write(join(directory, "check.md"), report.markdown);
  if (process.env.GITHUB_ACTIONS === "true") {
    // Source-controlled text must not execute workflow commands when printed.
    const token = crypto.randomUUID();
    process.stdout.write(`::stop-commands::${token}\n${report.text}::${token}::\n`);
    process.stdout.write(report.annotations.join("\n") + "\n");
  } else {
    process.stdout.write(report.text);
  }
}
