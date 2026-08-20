import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import { fileArguments } from "../../parameters";
import type { InspectFlags } from "./impl";

export const inspectCommand = buildCommand<InspectFlags, string[], CliContext>({
  loader: () => import("./impl"),
  parameters: {
    flags: {
      json: {
        kind: "boolean",
        optional: true,
        brief: "Write the versioned effective Shape model as JSON."
      }
    },
    positional: fileArguments()
  },
  docs: {
    brief: "Export the effective Shape model for tools.",
    fullDescription:
      "Parses and lowers the discovered model with canonical module-qualified identities, then writes a deterministic versioned JSON document. This export does not replace `shp check`.",
    customUsage: [
      {
        input: "--json [files...]",
        brief: "Write the effective model as deterministic JSON."
      }
    ]
  }
});
