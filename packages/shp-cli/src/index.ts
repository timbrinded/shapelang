#!/usr/bin/env bun

import { ExitCode, run } from "@stricli/core";
import { app } from "./app";

await main();

async function main(): Promise<void> {
  await run(app, Bun.argv.slice(2), { process });

  const exitCode = Number(process.exitCode);
  const wrappedInvalidArgument = 256 + ExitCode.InvalidArgument;
  const wrappedUnknownCommand = 256 + ExitCode.UnknownCommand;
  const wrappedInternalError = 256 + ExitCode.InternalError;
  const wrappedCommandLoadError = 256 + ExitCode.CommandLoadError;
  const wrappedContextLoadError = 256 + ExitCode.ContextLoadError;

  if (
    exitCode === ExitCode.InvalidArgument ||
    exitCode === ExitCode.UnknownCommand ||
    exitCode === wrappedInvalidArgument ||
    exitCode === wrappedUnknownCommand
  ) {
    process.exitCode = 2;
  } else if (
    exitCode === ExitCode.InternalError ||
    exitCode === ExitCode.CommandLoadError ||
    exitCode === ExitCode.ContextLoadError ||
    exitCode === wrappedInternalError ||
    exitCode === wrappedCommandLoadError ||
    exitCode === wrappedContextLoadError
  ) {
    process.exitCode = 1;
  }
}
