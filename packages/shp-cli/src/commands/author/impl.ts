import { generateShapeUpdateDraft } from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { stdout } from "../../io";
import { readChangedFiles } from "../../shape-files";

export type AuthorFlags = {
  readonly changedFiles: string;
  readonly component: string;
  readonly module?: string;
};

export default async function author(this: CliContext, flags: AuthorFlags): Promise<void> {
  const changedFiles = await readChangedFiles(flags.changedFiles);
  stdout(
    this,
    generateShapeUpdateDraft({
      changedFiles,
      componentName: flags.component,
      moduleName: flags.module
    })
  );
}
