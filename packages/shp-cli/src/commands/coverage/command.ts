import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import { fileArguments } from "../../parameters";
import type { CoverageFlags } from "./impl";

export const coverageCommand = buildCommand<CoverageFlags, string[], CliContext>({
  loader: () => import("./impl"),
  parameters: {
    flags: {
      changedFiles: {
        kind: "parsed",
        parse: (input: string) => input,
        brief: "Path to a newline-delimited changed-file list.",
        placeholder: "changed.txt"
      }
    },
    positional: fileArguments()
  },
  docs: {
    brief: "Run changed-file Shape coverage checks.",
    fullDescription:
      "Requires Shape updates or current attestations when governed source paths change. Bindings are not enforced in coverage-only mode.",
    customUsage: [
      {
        input: "--changed-files changed.txt [files...]",
        brief: "Run changed-file coverage checks."
      }
    ]
  }
});
