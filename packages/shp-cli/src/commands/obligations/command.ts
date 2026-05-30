import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import { fileArguments } from "../../parameters";
import type { ObligationsFlags } from "./impl";

export const obligationsCommand = buildCommand<ObligationsFlags, string[], CliContext>({
  loader: () => import("./impl"),
  parameters: {
    flags: {
      strictFreshness: {
        kind: "boolean",
        optional: true,
        brief: "Also list design memory whose review_by date is before today."
      }
    },
    positional: fileArguments()
  },
  docs: {
    brief: "List open Shape obligations.",
    customUsage: [
      {
        input: "[--strict-freshness] [files...]",
        brief: "List open design-memory obligations from checker diagnostics."
      }
    ]
  }
});
