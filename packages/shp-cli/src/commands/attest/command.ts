import { buildCommand, buildRouteMap } from "@stricli/core";
import type { CliContext } from "../../context";
import { baseModelFlags, fileArguments } from "../../parameters";
import type { AttestPruneFlags } from "./impl";

const attestPruneCommand = buildCommand<AttestPruneFlags, string[], CliContext>({
  loader: async () => (await import("./impl")).attestPrune,
  parameters: {
    flags: {
      ...baseModelFlags
    },
    positional: fileArguments()
  },
  docs: {
    brief: "Delete attestations that are unchanged from the base model.",
    fullDescription:
      "Removes each attestation, including one inside a change block, whose kind, path, and reason already exist in the base model, the same attestations shp check reports as stale. Requires --base-ref or --base-model. Git history keeps the removed decisions.",
    customUsage: [
      {
        input: "(--base-ref REF | --base-model DIR) [files...]",
        brief: "Delete stale attestations."
      }
    ]
  }
});

export const attestCommand = buildRouteMap({
  routes: {
    prune: attestPruneCommand
  },
  docs: {
    brief: "Maintain attestations."
  }
});
