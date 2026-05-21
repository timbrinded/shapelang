import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import { requiredStringArguments } from "../../parameters";
import type { ExplainFlags } from "./impl";

export const explainCommand = buildCommand<ExplainFlags, string[], CliContext>({
  loader: () => import("./impl"),
  parameters: {
    positional: requiredStringArguments(1, "Symbol followed by optional Shape files.", "args")
  },
  docs: {
    brief: "Explain facts and incident relations for a symbol.",
    customUsage: [
      {
        input: "SYMBOL [files...]",
        brief: "Print derived facts and incident relations for a symbol."
      }
    ]
  }
});
