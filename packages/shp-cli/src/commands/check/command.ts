import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import { fileArguments } from "../../parameters";
import type { CheckFlags } from "./impl";

export const checkCommand = buildCommand<CheckFlags, string[], CliContext>({
  loader: () => import("./impl"),
  parameters: {
    flags: {
      allowUnknownEffects: {
        kind: "boolean",
        optional: true,
        brief: "Allow effects unknown as a non-fatal warning while validating drafts."
      },
      changedFiles: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Path to a newline-delimited changed-file list.",
        placeholder: "changed.txt"
      },
      asOf: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief:
          "Freshness reference date (ISO YYYY-MM-DD); enforces stale design memory deterministically.",
        placeholder: "YYYY-MM-DD"
      },
      strictFreshness: {
        kind: "boolean",
        optional: true,
        brief: "Shorthand for --as-of today (UTC); fails when review_by is before today."
      }
    },
    aliases: {},
    positional: fileArguments()
  },
  docs: {
    brief: "Run Shape semantic checks.",
    fullDescription:
      "Parses modules, lowers facts, and runs semantic checks. With --allow-unknown-effects, effects unknown is reported as a non-fatal draft warning while all other diagnostics remain blocking. With --changed-files, also runs coverage and bindings. With --as-of (or --strict-freshness for today), stale design memory becomes a check failure.",
    customUsage: [
      {
        input:
          "[--allow-unknown-effects] [--changed-files changed.txt] [--as-of YYYY-MM-DD | --strict-freshness] [files...]",
        brief: "Run semantic checks."
      }
    ]
  }
});
