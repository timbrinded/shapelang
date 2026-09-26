import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import { fileArguments } from "../../parameters";

export const memoryCommand = buildCommand<{}, string[], CliContext>({
  loader: async () => {
    const { listMemoryGuardsShapeModules } = await import("@shape/shp-checker");
    const { stdout } = await import("../../io");
    const { parseProvidedOrDefaultModules } = await import("../../shape-files");
    return async function memory(_flags, ...providedFiles) {
      const modules = await parseProvidedOrDefaultModules(providedFiles);
      stdout(this, listMemoryGuardsShapeModules(modules));
    };
  },
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
