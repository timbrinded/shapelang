import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import { fileArguments } from "../../parameters";
import type { ObligationsFlags } from "./impl";

export const obligationsCommand = buildCommand<ObligationsFlags, string[], CliContext>({
  loader: () => import("./impl"),
  parameters: {
    positional: fileArguments()
  },
  docs: {
    brief: "List open Shape obligations.",
    customUsage: [
      {
        input: "[files...]",
        brief: "List open design-memory obligations from checker diagnostics."
      }
    ]
  }
});
