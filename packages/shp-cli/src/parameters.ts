import type { TypedPositionalParameters } from "@stricli/core";
import type { CliContext } from "./context";

export const stringParameter = (brief: string, placeholder: string) => ({
  parse: (input: string) => input,
  brief,
  placeholder
});

export const fileArguments = (
  brief = "Shape files to read. Defaults to shape/**/*.shape.",
  placeholder = "files"
): TypedPositionalParameters<string[], CliContext> => ({
  kind: "array",
  parameter: stringParameter(brief, placeholder),
  minimum: 0
});

/** `--base-ref` / `--base-model`, shared by `check` and `coverage`. */
export const baseModelFlags = {
  baseRef: {
    kind: "parsed",
    parse: (input: string) => input,
    optional: true,
    brief:
      "Compare attestations against the Shape model at the merge base of this git revision and HEAD.",
    placeholder: "REF"
  },
  baseModel: {
    kind: "parsed",
    parse: (input: string) => input,
    optional: true,
    brief:
      "Compare attestations against a copy of the base model in this directory, kept at repository paths.",
    placeholder: "DIR"
  }
} as const;

export const requiredStringArguments = (
  minimum: number,
  brief: string,
  placeholder: string
): TypedPositionalParameters<string[], CliContext> => ({
  kind: "array",
  parameter: stringParameter(brief, placeholder),
  minimum
});
