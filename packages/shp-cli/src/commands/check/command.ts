import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import {
  baseModelFlags,
  fileArguments,
  optionalStringFlag,
  optionalBooleanFlag
} from "../../parameters";
import type { CheckFlags } from "./impl";

export const checkCommand = buildCommand<CheckFlags, string[], CliContext>({
  loader: () => import("./impl"),
  parameters: {
    flags: {
      allowUnknownEffects: optionalBooleanFlag(
        "Allow effects unknown as a non-fatal warning while validating drafts."
      ),
      changedFiles: optionalStringFlag(
        "Path to a newline-delimited changed-file list.",
        "changed.txt"
      ),
      ...baseModelFlags,
      checkCitedPaths: optionalBooleanFlag(
        "Fail when a source or evidence path the model cites is not a file in the git repository."
      ),
      asOf: optionalStringFlag(
        "Freshness reference date (ISO YYYY-MM-DD); enforces stale design memory deterministically.",
        "YYYY-MM-DD"
      ),
      strictFreshness: optionalBooleanFlag(
        "Shorthand for --as-of today (UTC); fails when review_by is before today."
      )
    },
    aliases: {},
    positional: fileArguments()
  },
  docs: {
    brief: "Run Shape semantic checks.",
    fullDescription:
      "Parses modules, lowers facts, and runs semantic checks. With --allow-unknown-effects, effects unknown is reported as a non-fatal draft warning while all other diagnostics remain blocking. With --changed-files, also runs coverage and bindings. With --base-ref or --base-model, only attestations new relative to that base count, and unchanged ones are reported as stale warnings. With --check-cited-paths, every source and evidence path the model cites must be a file in the git repository. With --as-of (or --strict-freshness for today), stale design memory becomes a check failure.",
    customUsage: [
      {
        input:
          "[--allow-unknown-effects] [--changed-files changed.txt] [--base-ref REF | --base-model DIR] [--check-cited-paths] [--as-of YYYY-MM-DD | --strict-freshness] [files...]",
        brief: "Run semantic checks."
      }
    ]
  }
});
