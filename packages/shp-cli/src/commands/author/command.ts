import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import type { AuthorFlags } from "./impl";

export const authorCommand = buildCommand<AuthorFlags, [], CliContext>({
  loader: () => import("./impl"),
  parameters: {
    flags: {
      changedFiles: {
        kind: "parsed",
        parse: (input: string) => input,
        brief: "Path to a newline-delimited changed-file list.",
        placeholder: "changed.txt"
      },
      component: {
        kind: "parsed",
        parse: (input: string) => input,
        brief: "Component to scaffold.",
        placeholder: "ComponentName"
      },
      module: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Shape module name for the generated draft.",
        placeholder: "module.name"
      }
    }
  },
  docs: {
    brief: "Generate a conservative Shape update draft.",
    customUsage: [
      {
        input: "--changed-files changed.txt --component ComponentName [--module module.name]",
        brief: "Generate a conservative global-model draft from changed files."
      }
    ]
  }
});
