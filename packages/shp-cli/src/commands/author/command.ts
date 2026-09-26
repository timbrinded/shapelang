import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import { optionalStringFlag, optionalBooleanFlag } from "../../parameters";
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
      component: optionalStringFlag("Component to scaffold.", "ComponentName"),
      criticPrompt: optionalStringFlag(
        "Proposed Shape update to review with a provider-neutral critic prompt.",
        "proposed.shape"
      ),
      diff: optionalStringFlag("Unified PR diff used as prompt context.", "pr.diff"),
      instructions: optionalStringFlag("Additional human direction for prompt mode.", "TEXT"),
      module: optionalStringFlag("Shape module name for the generated draft.", "module.name"),
      projectPrelude: optionalStringFlag(
        "Project prelude context file for prompt mode.",
        "prelude.shape"
      ),
      prompt: optionalBooleanFlag(
        "Emit a provider-neutral authoring prompt bundle instead of the draft."
      ),
      shapeFiles: optionalStringFlag(
        "Comma-separated existing Shape files required by prompt mode.",
        "file1.shape,file2.shape"
      ),
      snippetFiles: optionalStringFlag(
        "Comma-separated relevant source files for prompt mode.",
        "file1.ts,file2.rs"
      )
    }
  },
  docs: {
    brief: "Generate a Shape draft, authoring prompt, or advisory critic review.",
    customUsage: [
      {
        input: "--changed-files changed.txt --component ComponentName [--module module.name]",
        brief: "Generate a conservative global-model draft from changed files."
      },
      {
        input:
          "--changed-files changed.txt --component ComponentName --diff pr.diff --prompt --shape-files file1.shape,file2.shape [--snippet-files file1.ts,file2.rs] [--project-prelude prelude.shape] [--instructions TEXT]",
        brief: "Emit a context-rich prompt without invoking a model provider."
      },
      {
        input:
          "--changed-files changed.txt --diff pr.diff --critic-prompt proposed.shape --shape-files file1.shape,file2.shape [--snippet-files file1.ts,file2.rs] [--project-prelude prelude.shape] [--instructions TEXT]",
        brief: "Emit a critic prompt plus deterministic local advisories."
      }
    ]
  }
});
