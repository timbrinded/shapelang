import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import { fileArguments, optionalStringFlag, optionalBooleanFlag } from "../../parameters";
import type { ObligationsFlags } from "./impl";

export const obligationsCommand = buildCommand<ObligationsFlags, string[], CliContext>({
  loader: () => import("./impl"),
  parameters: {
    flags: {
      asOf: optionalStringFlag(
        "Freshness reference date (ISO YYYY-MM-DD); also lists design memory whose review_by is before it.",
        "YYYY-MM-DD"
      ),
      strictFreshness: optionalBooleanFlag(
        "Shorthand for --as-of today (UTC); also lists design memory whose review_by is before today."
      )
    },
    positional: fileArguments()
  },
  docs: {
    brief: "List open Shape obligations.",
    customUsage: [
      {
        input: "[--as-of YYYY-MM-DD | --strict-freshness] [files...]",
        brief: "List open design-memory obligations from checker diagnostics."
      }
    ]
  }
});
