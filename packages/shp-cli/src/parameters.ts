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

export const requiredStringArguments = (
  minimum: number,
  brief: string,
  placeholder: string
): TypedPositionalParameters<string[], CliContext> => ({
  kind: "array",
  parameter: stringParameter(brief, placeholder),
  minimum
});
