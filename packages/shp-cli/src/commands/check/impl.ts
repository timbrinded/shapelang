import { readAttestationMode, resolveCheckTransition } from "../../check-input";
import { AttestationError } from "@shape/shp-checker";
import { cliExitCode, errorMessage } from "../../errors";
import { stdout, setExitCode } from "../../io";
import { runShapeFileCheck } from "../../check-runner";
import type { CliContext } from "../../context";
import { resolveFreshnessDate } from "../../freshness";
import { readChangedFiles } from "../../shape-files";

export type CheckFlags = {
  readonly json?: boolean;
  readonly config?: string;
  readonly base?: string;
  readonly head?: string;
  readonly worktree?: boolean;
  readonly attestations?: string;
  readonly allowUnknownEffects?: boolean;
  readonly changedFiles?: string;
  readonly asOf?: string;
  readonly strictFreshness?: boolean;
};

export default async function check(
  this: CliContext,
  flags: CheckFlags,
  ...providedFiles: string[]
): Promise<void> {
  try {
    const attestationMode = await readAttestationMode(flags.config);
    const input = resolveCheckTransition(flags);
    const changedFiles =
      input.changedFiles ??
      (flags.changedFiles !== undefined ? await readChangedFiles(flags.changedFiles) : undefined);
    let attestations: unknown;
    if (flags.attestations !== undefined) {
      try {
        attestations = await Bun.file(flags.attestations).json();
      } catch {
        throw new AttestationError("malformed", "Cannot read attestation JSON bundle.");
      }
    }
    await runShapeFileCheck(
      this,
      providedFiles,
      {
        allowUnknownEffects: flags.allowUnknownEffects,
        changedFiles,
        enforceBindings: true,
        freshnessDate: resolveFreshnessDate(flags),
        attestationMode,
        transition: input.transition,
        repoRoot: input.repoRoot,
        attestations
      },
      flags.json
    );
  } catch (error) {
    if (!flags.json) throw error;
    const exitCode = error instanceof AttestationError ? 1 : cliExitCode(error);
    stdout(
      this,
      JSON.stringify({
        ok: false,
        exitCode,
        obligations: [],
        diagnostics: [
          {
            kind: error instanceof AttestationError ? "attestation_error" : "check_input_error",
            code: error instanceof AttestationError ? error.code : "invalid_input",
            message: errorMessage(error)
          }
        ]
      }) + "\n"
    );
    setExitCode(this, exitCode);
  }
}
