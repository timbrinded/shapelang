import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import { requiredStringArguments, optionalStringFlag } from "../../parameters";
import type { AnalyzeFlags } from "./impl";

export const analyzeCommand = buildCommand<AnalyzeFlags, string[], CliContext>({
  loader: () => import("./impl"),
  parameters: {
    flags: {
      shapeFiles: optionalStringFlag(
        "Comma-separated Shape files to compare against analyzer hints.",
        "file1.shape,file2.shape"
      )
    },
    positional: requiredStringArguments(0, "Source files to analyze.", "source-files")
  },
  docs: {
    brief: "Analyze source hints and compare them to Shape effects.",
    customUsage: [
      {
        input: "[--shape-files file1.shape,file2.shape] [source-files...]",
        brief: "Emit source hints or compare source hints with declared effects."
      }
    ]
  }
});
