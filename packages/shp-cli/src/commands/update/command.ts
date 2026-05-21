import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import type { UpdateFlags } from "./impl";

export const updateCommand = buildCommand<UpdateFlags, [], CliContext>({
  loader: () => import("./impl"),
  parameters: {
    flags: {
      version: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Release tag to install, such as v0.3.0. Defaults to latest.",
        placeholder: "VERSION"
      },
      dryRun: {
        kind: "boolean",
        optional: true,
        brief: "Show the selected release and binary path without downloading."
      },
      path: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Executable path to replace. Defaults to the running shp binary.",
        placeholder: "PATH"
      }
    }
  },
  docs: {
    brief: "Update the released shp binary in place.",
    customUsage: [
      {
        input: "[--version VERSION] [--dry-run] [--path PATH]",
        brief: "Download a GitHub release asset, verify it, and replace the local binary."
      }
    ]
  }
});
