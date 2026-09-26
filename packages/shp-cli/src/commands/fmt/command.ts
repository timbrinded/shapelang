import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import { fileArguments, optionalBooleanFlag } from "../../parameters";
import type { FmtFlags } from "./impl";

export const fmtCommand = buildCommand<FmtFlags, string[], CliContext>({
  loader: () => import("./impl"),
  parameters: {
    flags: {
      check: optionalBooleanFlag("Check formatting without writing files.")
    },
    positional: fileArguments()
  },
  docs: {
    brief: "Format Shape files.",
    customUsage: [
      {
        input: "[--check] [files...]",
        brief: "Format Shape files, or check formatting with --check."
      }
    ]
  }
});
