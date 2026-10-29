import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import type { TsContractFlags } from "./impl";

export const tsContractCommand = buildCommand<TsContractFlags, [], CliContext>({
  loader: () => import("./impl"),
  parameters: {
    flags: {
      config: {
        kind: "parsed",
        parse: (value: string) => value,
        brief: "Authored TypeScript contract gate JSON configuration.",
        placeholder: "shape-ts-contract.json"
      },
      runExternalCode: {
        kind: "boolean",
        optional: true,
        brief: "Authorize the project-local TypeScript compiler and native content mapper."
      }
    }
  },
  docs: {
    brief: "Check opt-in TypeScript source registrations and native signature contracts.",
    fullDescription:
      "Census all governed filesystem sources, validate sibling authored contracts and project-local mapper/compiler configuration, then run the pinned native compiler with --noEmit. Ordinary Shape checks are unchanged."
  }
});
