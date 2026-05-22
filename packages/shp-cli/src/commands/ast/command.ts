import { buildCommand, buildRouteMap } from "@stricli/core";
import type { CliContext } from "../../context";
import { requiredStringArguments } from "../../parameters";
import type { AstJsonFlags, AstSourceFlags } from "./impl";

const moduleFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
  optional: true as const,
  brief: "Module name for the generated Shape draft.",
  placeholder: "NAME"
};

const includeAstLayerFlag = {
  kind: "boolean" as const,
  optional: true as const,
  brief: "Include raw AST resources and ast_child relations."
};

const rawOutFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
  optional: true as const,
  brief: "Write raw AST trace Shape to a sidecar file.",
  placeholder: "PATH"
};

const outDirFlag = {
  kind: "parsed" as const,
  parse: (input: string) => input,
  optional: true as const,
  brief: "Write generated semantic AST Shape files under a directory.",
  placeholder: "DIR"
};

export const astSourceCommand = buildCommand<AstSourceFlags, string[], CliContext>({
  loader: async () => (await import("./impl")).astSource,
  parameters: {
    flags: {
      language: {
        kind: "parsed",
        parse: (input: string) => input,
        optional: true,
        brief: "Override source language for every input file.",
        placeholder: "LANG"
      },
      module: moduleFlag,
      includeAstLayer: includeAstLayerFlag,
      rawOut: rawOutFlag,
      outDir: outDirFlag,
      check: {
        kind: "boolean",
        optional: true,
        brief: "With --out-dir, fail when generated files are not up to date."
      },
      allowParseErrors: {
        kind: "boolean",
        optional: true,
        brief: "Emit a draft even when Tree-sitter reports syntax errors."
      }
    },
    positional: requiredStringArguments(1, "Source files to parse.", "files")
  },
  docs: {
    brief: "Generate a conservative Shape draft from source files.",
    customUsage: [
      {
        input:
          "[--language LANG] [--module NAME] [--include-ast-layer] [--raw-out PATH] [--out-dir DIR] files...",
        brief: "Parse source with Tree-sitter and print the semantic Shape draft."
      }
    ]
  }
});

export const astJsonCommand = buildCommand<AstJsonFlags, string[], CliContext>({
  loader: async () => (await import("./impl")).astJson,
  parameters: {
    flags: {
      module: moduleFlag,
      includeAstLayer: includeAstLayerFlag,
      rawOut: rawOutFlag
    },
    positional: requiredStringArguments(1, "AST JSON file to read.", "ast-json")
  },
  docs: {
    brief: "Generate a conservative Shape draft from external AST JSON.",
    customUsage: [
      {
        input: "[--module NAME] [--include-ast-layer] [--raw-out PATH] ast.json",
        brief: "Read normalized AST JSON and print the semantic Shape draft."
      }
    ]
  }
});

export const astCommand = buildRouteMap({
  routes: {
    source: astSourceCommand,
    json: astJsonCommand
  },
  docs: {
    brief: "Generate Shape drafts from source ASTs.",
    fullDescription:
      "The default output is a conservative semantic architecture draft. Raw AST resources are emitted only when --include-ast-layer or --raw-out is provided."
  }
});
