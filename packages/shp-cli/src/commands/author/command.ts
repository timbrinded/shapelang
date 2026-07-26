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
      diff: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Unified PR diff used as prompt context.",
        placeholder: "pr.diff"
      },
      instructions: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Additional human direction for prompt mode.",
        placeholder: "TEXT"
      },
      module: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Shape module name for the generated draft.",
        placeholder: "module.name"
      },
      projectPrelude: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Project prelude context file for prompt mode.",
        placeholder: "prelude.shape"
      },
      prompt: {
        kind: "boolean",
        optional: true,
        brief: "Emit a provider-neutral authoring prompt bundle instead of the draft."
      },
      shapeFiles: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Comma-separated existing Shape files required by prompt mode.",
        placeholder: "file1.shape,file2.shape"
      },
      snippetFiles: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Comma-separated relevant source files for prompt mode.",
        placeholder: "file1.ts,file2.rs"
      }
    }
  },
  docs: {
    brief: "Generate a conservative Shape draft or provider-neutral authoring prompt.",
    customUsage: [
      {
        input: "--changed-files changed.txt --component ComponentName [--module module.name]",
        brief: "Generate a conservative global-model draft from changed files."
      },
      {
        input:
          "--changed-files changed.txt --component ComponentName --diff pr.diff --prompt --shape-files file1.shape,file2.shape [--snippet-files file1.ts,file2.rs] [--project-prelude prelude.shape] [--instructions TEXT]",
        brief: "Emit a context-rich prompt without invoking a model provider."
      }
    ]
  }
});
