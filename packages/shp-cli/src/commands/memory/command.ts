import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import { fileArguments } from "../../parameters";
import type { MemoryFlags } from "./impl";

export const memoryCommand = buildCommand<MemoryFlags, string[], CliContext>({
  loader: () => import("./impl"),
  parameters: {
    positional: fileArguments()
  },
  docs: {
    brief: "List Shape memory guards.",
    customUsage: [
      {
        input: "[files...]",
        brief: "List rationale and memory entries grouped by protected target."
      }
    ]
  }
});
