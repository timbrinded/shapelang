import { formatShapeSource } from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { EXIT_FAILURE, EXIT_SUCCESS } from "../../errors";
import { setExitCode, stderr, stdout } from "../../io";
import { defaultShapeFiles, readCliTextFile } from "../../shape-files";

export type FmtFlags = {
  readonly check?: boolean;
};

export default async function fmt(
  this: CliContext,
  flags: FmtFlags,
  ...providedFiles: string[]
): Promise<void> {
  const files = providedFiles.length > 0 ? providedFiles : await defaultShapeFiles();
  const checkOnly = flags.check === true;
  let ok = true;

  for (const file of files) {
    const source = await readCliTextFile(file);
    const result = formatShapeSource(source, file);
    if (!result.ok) {
      ok = false;
      for (const diagnostic of result.diagnostics) {
        stderr(this, `${diagnostic.filePath}: ${diagnostic.message}\n`);
      }
      continue;
    }

    if (checkOnly) {
      if (source !== result.formatted) {
        ok = false;
        stderr(this, `${file}: not formatted\n`);
      }
    } else if (source !== result.formatted) {
      await Bun.write(file, result.formatted);
    }
  }

  if (ok) {
    stdout(this, checkOnly ? "Shape format check passed.\n" : "Shape format complete.\n");
  }

  setExitCode(this, ok ? EXIT_SUCCESS : EXIT_FAILURE);
}
