import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import { fileArguments } from "../../parameters";
import type { CheckFlags } from "./impl";

export const checkCommand = buildCommand<CheckFlags, string[], CliContext>({
  loader: () => import("./impl"),
  parameters: {
    flags: {
      changedFiles: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Path to a newline-delimited changed-file list.",
        placeholder: "changed.txt"
      },
      strictFreshness: {
        kind: "boolean",
        optional: true,
        brief: "Fail when design memory review_by dates are before today."
      }
    },
    aliases: {},
    positional: fileArguments()
  },
  docs: {
    brief: "Run Shape semantic checks.",
    fullDescription:
      "Parses modules, lowers facts, and runs semantic checks. With --changed-files, also runs coverage and bindings. With --strict-freshness, stale design memory becomes a check failure.",
    customUsage: [
      {
        input: "[--changed-files changed.txt] [--strict-freshness] [files...]",
        brief: "Run semantic checks."
      }
    ]
  }
});
