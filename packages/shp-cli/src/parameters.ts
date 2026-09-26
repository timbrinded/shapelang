import type { TypedPositionalParameters } from "@stricli/core";
import type { CliContext } from "./context";

export const stringParameter = (brief: string, placeholder: string) => ({
  parse: (input: string) => input,
  brief,
  placeholder
});

export const optionalStringFlag = (brief: string, placeholder: string) => ({
  kind: "parsed" as const,
  optional: true as const,
  ...stringParameter(brief, placeholder)
});

export const optionalBooleanFlag = (brief: string) => ({
  kind: "boolean" as const,
  optional: true as const,
  brief
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
  baseRef: optionalStringFlag(
    "Compare attestations against the Shape model at the merge base of this git revision and HEAD.",
    "REF"
  ),
  baseModel: optionalStringFlag(
    "Compare attestations against a copy of the base model in this directory, kept at repository paths.",
    "DIR"
  )
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
