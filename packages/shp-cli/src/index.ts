#!/usr/bin/env bun

import { ExitCode, run } from "@stricli/core";
import { app } from "./app";

await main();

async function main(): Promise<void> {
  await run(app, Bun.argv.slice(2), { process });

  const exitCode = Number(process.exitCode);
  // Bun may expose negative Stricli statuses as unsigned exit bytes.
  const stricliCode = exitCode > 0 ? exitCode - 256 : exitCode;

  if (stricliCode === ExitCode.InvalidArgument || stricliCode === ExitCode.UnknownCommand) {
    process.exitCode = 2;
  } else if (
    stricliCode === ExitCode.InternalError ||
    stricliCode === ExitCode.CommandLoadError ||
    stricliCode === ExitCode.ContextLoadError
  ) {
    process.exitCode = 1;
  }
}
