import { buildCommand, buildRouteMap } from "@stricli/core";
import type { CliContext } from "../../context";
import { fileArguments, requiredStringArguments } from "../../parameters";
import type { GraphFlags, LegacyGraphFlags } from "./impl";

const kindFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
  optional: true as const,
  brief: "Filter by relation kind.",
  placeholder: "KIND"
};

const graphAllCommand = buildCommand<GraphFlags, string[], CliContext>({
  loader: async () => (await import("./impl")).graphAll,
  parameters: {
    flags: {
      kind: kindFlag
    },
    positional: fileArguments()
  },
  docs: {
    brief: "Print every relation in the hypergraph.",
    customUsage: [
      {
        input: "[--kind KIND] [files...]",
        brief: "Print every relation in the hypergraph."
      }
    ]
  }
});

const graphShowCommand = buildCommand<GraphFlags, string[], CliContext>({
  loader: async () => (await import("./impl")).graphShow,
  parameters: {
    flags: {
      kind: kindFlag
    },
    positional: requiredStringArguments(1, "Symbol followed by optional Shape files.", "args")
  },
  docs: {
    brief: "Print hypergraph incidence for a symbol.",
    customUsage: [
      {
        input: "SYMBOL [--kind KIND] [files...]",
        brief: "Print the hyperedges incident to a component or resource."
      }
    ]
  }
});

const graphStatsCommand = buildCommand<GraphFlags, string[], CliContext>({
  loader: async () => (await import("./impl")).graphStats,
  parameters: {
    flags: {
      kind: kindFlag
    },
    positional: fileArguments()
  },
  docs: {
    brief: "Print aggregate hypergraph statistics.",
    customUsage: [
      {
        input: "[--kind KIND] [files...]",
        brief: "Print aggregate vertex, hyperedge, and incidence counts."
      }
    ]
  }
});

const legacyGraphCommand = buildCommand<LegacyGraphFlags, string[], CliContext>({
  loader: async () => (await import("./impl")).graphLegacy,
  parameters: {
    flags: {
      kind: kindFlag,
      stats: {
        kind: "boolean",
        optional: true,
        brief: "Print aggregate hypergraph statistics."
      }
    },
    positional: fileArguments("Legacy graph arguments.", "args")
  },
  docs: {
    brief: "Run the legacy graph argument parser.",
    customUsage: [
      {
        input: "[SYMBOL] [--kind KIND] [files...]",
        brief: "Compatibility form; all, show, and stats are reserved."
      },
      {
        input: "--stats [--kind KIND] [files...]",
        brief: "Compatibility form for graph stats."
      }
    ]
  }
});

export const graphCommand = buildRouteMap({
  routes: {
    all: graphAllCommand,
    show: graphShowCommand,
    stats: graphStatsCommand,
    $legacy: legacyGraphCommand
  },
  defaultCommand: "$legacy",
  docs: {
    brief: "Inspect Shape relation hypergraphs.",
    fullDescription:
      "`graph all`, `graph show`, and `graph stats` are the preferred explicit forms. Legacy `shp graph ...` invocations remain supported, except legacy symbols named all, show, or stats must use `graph show SYMBOL`.",
    hideRoute: {
      $legacy: true
    }
  }
});
