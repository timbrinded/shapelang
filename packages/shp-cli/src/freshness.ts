import { CliDiagnosticError, EXIT_USAGE } from "./errors";

/**
 * Today's date as an ISO `YYYY-MM-DD` string. The wall clock is read only here
 * at the CLI boundary; the checker is always handed an explicit date and stays
 * deterministic. `toISOString` yields the UTC calendar day, so prefer an
 * explicit `--as-of` when the local calendar day matters.
 */
export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate an explicit `--as-of` value as a real ISO `YYYY-MM-DD` calendar
 * date, rejecting malformed or impossible dates (e.g. `2026-02-30`) once at the
 * CLI boundary rather than letting a bad date flow into freshness comparison.
 */
export function parseAsOfDate(input: string): string {
  const parsed = new Date(`${input}T00:00:00Z`);
  if (
    !ISO_DATE.test(input) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== input
  ) {
    throw new CliDiagnosticError(
      `error: --as-of expects an ISO YYYY-MM-DD date, received ${JSON.stringify(input)}\n`,
      EXIT_USAGE
    );
  }
  return input;
}

/**
 * Resolve the freshness date a freshness-aware command should enforce. An
 * explicit `--as-of` always wins (and is validated); otherwise `--strict-freshness`
 * is sugar for "today"; otherwise freshness checking is off. Centralising this
 * keeps `check` and `obligations` consistent and the clock read in one place.
 */
export function resolveFreshnessDate(flags: {
  readonly asOf?: string;
  readonly strictFreshness?: boolean;
}): string | undefined {
  if (flags.asOf !== undefined) {
    return parseAsOfDate(flags.asOf);
  }
  return flags.strictFreshness ? isoToday() : undefined;
}
