import { describe, expect, test } from "bun:test";
import { formatDiagnostics, listShapeObligations, parseShapeModule } from "./index.ts";
import { checkShapeSource, contextRef, fnTarget } from "./test-support.ts";

describe("Shape memory freshness checking", () => {
  function refactorMemorySource(reviewBy?: string): string {
    const reviewByLine = reviewBy === undefined ? "" : `\n        when { review_by "${reviewBy}" }`;
    return `
      module bridge

      resource Attestation

      component BridgePoller {
        owns Attestation
        grants Read<Attestation>

        fn pollAttestation : RefactorSensitive
          effects complete {
            Read<Attestation>
          }
      }

      memory BridgePollingDelayConstraint : ${contextRef("RefactorConstraint", fnTarget("BridgePoller.pollAttestation"))} {
        applies_to fn BridgePoller.pollAttestation
        status Unexplained
        confidence High
        summary "Earlier attempts to lower this delay caused settlement failures."
        who { owner BridgeTeam }${reviewByLine}
      }
    `;
  }

  // Thin wrapper over the shared checkShapeSource helper so the parse/error flow
  // lives in one place; this only threads the freshness option through.
  function checkWithFreshness(source: string, freshnessDate?: string) {
    return checkShapeSource(source, { freshnessDate });
  }

  test("flags design memory whose review_by is before the freshness date", () => {
    const result = checkWithFreshness(refactorMemorySource("2026-01-01"), "2026-05-30");
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("stale design memory");
    expect(output).toContain("memory BridgePollingDelayConstraint");
    expect(output).toContain("review_by date 2026-01-01 is before 2026-05-30");
  });

  test("keeps memory fresh on the review_by date itself", () => {
    const result = checkWithFreshness(refactorMemorySource("2026-05-30"), "2026-05-30");

    expect(result.exitCode).toBe(0);
  });

  test("treats future review_by dates as fresh", () => {
    const result = checkWithFreshness(refactorMemorySource("2027-01-01"), "2026-05-30");

    expect(result.exitCode).toBe(0);
  });

  test("ignores memory without a review_by date", () => {
    const result = checkWithFreshness(refactorMemorySource(), "2026-05-30");

    expect(result.exitCode).toBe(0);
  });

  test("does not enforce non-ISO review_by values", () => {
    const result = checkWithFreshness(refactorMemorySource("soon"), "2026-05-30");

    expect(result.exitCode).toBe(0);
  });

  test("does not enforce calendar-invalid ISO-shaped review_by values", () => {
    // These match the YYYY-MM-DD regex but are not real dates; the calendar
    // round-trip in isIsoDate must reject them rather than letting Date roll
    // them forward (2026-02-30 -> 2026-03-02) and suppress a real diagnostic.
    for (const invalid of ["2026-02-30", "2026-13-40"]) {
      const result = checkWithFreshness(refactorMemorySource(invalid), "2026-05-30");
      expect(result.exitCode).toBe(0);
    }
  });

  test("never reports staleness when freshness checking is disabled", () => {
    const result = checkWithFreshness(refactorMemorySource("2020-01-01"));

    expect(result.exitCode).toBe(0);
  });

  test("flags stale rationale review_by dates as well", () => {
    const result = checkWithFreshness(
      `
        module gateway

        resource PolicySnapshot

        component Gateway {
          owns PolicySnapshot
          grants Read<PolicySnapshot>

          fn derivePolicyDecision : PreserveInline
            effects complete {
              Read<PolicySnapshot>
            }
        }

        rationale DerivePolicyDecisionInline : ${contextRef("InlineRationale", fnTarget("Gateway.derivePolicyDecision"))} {
          applies_to fn Gateway.derivePolicyDecision
          why Auditability
          summary "Reviewers inspect the full authorization branch locally."
          who { owner GatewayTeam }
          when { review_by "2025-01-01" }
        }
      `,
      "2026-05-30"
    );
    const output = formatDiagnostics(result);

    expect(result.exitCode).toBe(1);
    expect(output).toContain("stale design memory");
    expect(output).toContain("rationale DerivePolicyDecisionInline");
  });

  test("surfaces stale design memory through obligations in strict freshness mode", () => {
    const parsed = parseShapeModule(refactorMemorySource("2026-01-01"));
    if (!parsed.ok) {
      throw new Error("expected module to parse");
    }

    const withFreshness = listShapeObligations([parsed.module], { freshnessDate: "2026-05-30" });
    expect(withFreshness).toContain("stale design memory:");
    expect(withFreshness).toContain(
      "memory BridgePollingDelayConstraint review_by 2026-01-01 is before 2026-05-30"
    );

    const withoutFreshness = listShapeObligations([parsed.module]);
    expect(withoutFreshness).not.toContain("stale design memory");
  });
});
