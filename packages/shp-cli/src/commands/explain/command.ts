import { buildCommand } from "@stricli/core";
import type { CliContext } from "../../context";
import { requiredStringArguments } from "../../parameters";

export const explainCommand = buildCommand<{}, string[], CliContext>({
  loader: async () => {
    const { explainShapeModules } = await import("@shape/shp-checker");
    const { stdout } = await import("../../io");
    const { parseProvidedOrDefaultModules } = await import("../../shape-files");
    return async function explain(_flags, ...args) {
      const [symbol, ...providedFiles] = args;
      const modules = await parseProvidedOrDefaultModules(providedFiles);
      stdout(this, explainShapeModules(modules, symbol ?? ""));
    };
  },
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
