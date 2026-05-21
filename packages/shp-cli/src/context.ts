import type { CommandContext, StricliProcess } from "@stricli/core";

export interface CliContext extends CommandContext {
  readonly process: StricliProcess;
}
