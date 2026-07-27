import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";

export const lspCommand = buildCommand<{}, [], CliContext>({
  loader: () => import("./impl"),
  parameters: {
    flags: {},
    positional: {
      kind: "tuple",
      parameters: []
    }
  },
  docs: {
    brief: "Run the Shape language server over standard input and output.",
    customUsage: [
      {
        input: "",
        brief: "Serve Language Server Protocol requests over stdio."
      }
    ]
  }
});
