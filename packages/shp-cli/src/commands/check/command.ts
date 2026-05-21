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
      }
    },
    aliases: {},
    positional: fileArguments()
  },
  docs: {
    brief: "Run Shape semantic checks.",
    fullDescription:
      "Parses modules, lowers facts, and runs semantic checks. With --changed-files, also runs coverage and bindings.",
    customUsage: [
      {
        input: "[--changed-files changed.txt] [files...]",
        brief: "Run semantic checks."
      }
    ]
  }
});
