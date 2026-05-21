import {
  ArgumentScannerError,
  buildApplication,
  buildRouteMap,
  formatMessageForArgumentScannerError,
  text_en
} from "@stricli/core";
import { analyzeCommand } from "./commands/analyze/command";
import { authorCommand } from "./commands/author/command";
import { checkCommand } from "./commands/check/command";
import { coverageCommand } from "./commands/coverage/command";
import { explainCommand } from "./commands/explain/command";
import { fmtCommand } from "./commands/fmt/command";
import { graphCommand } from "./commands/graph/command";
import { memoryCommand } from "./commands/memory/command";
import { obligationsCommand } from "./commands/obligations/command";
import type { CliContext } from "./context";
import { cliExitCode, errorMessage } from "./errors";
import { SHP_VERSION } from "./version";

const root = buildRouteMap({
  routes: {
    analyze: analyzeCommand,
    author: authorCommand,
    check: checkCommand,
    coverage: coverageCommand,
    explain: explainCommand,
    fmt: fmtCommand,
    graph: graphCommand,
    memory: memoryCommand,
    obligations: obligationsCommand
  },
  docs: {
    brief: "Check and maintain Shape architecture models.",
    fullDescription:
      "When no files are provided, Shape file commands scan shape/**/*.shape by default."
  }
});

const text = {
  ...text_en,
  exceptionWhileParsingArguments: (error: unknown) => {
    if (error instanceof ArgumentScannerError) {
      return `error: ${formatMessageForArgumentScannerError(error, {})}`;
    }
    return `error: ${errorMessage(error)}`;
  },
  exceptionWhileLoadingCommandFunction: (error: unknown) => `error: ${errorMessage(error)}`,
  exceptionWhileLoadingCommandContext: (error: unknown) => `error: ${errorMessage(error)}`,
  exceptionWhileRunningCommand: (error: unknown) => errorMessage(error),
  commandErrorResult: (error: Error) => error.message
};

export const app = buildApplication<CliContext>(root, {
  name: "shp",
  versionInfo: {
    currentVersion: SHP_VERSION
  },
  scanner: {
    caseStyle: "allow-kebab-for-camel"
  },
  localization: {
    text
  },
  determineExitCode: cliExitCode
});
