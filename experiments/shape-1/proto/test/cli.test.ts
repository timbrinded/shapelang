// The CLI: exit codes per verdict, JSON and core output, input round trip.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ex1, ex4 } from "../examples/fixtures.ts";
import { REPO_ROOT } from "../src/loader.ts";

const CLI = join(REPO_ROOT, "experiments/shape-1/proto/src/cli.ts");
const cli = (args: string[], stdin?: unknown) =>
  spawnSync("bun", [CLI, ...args], {
    cwd: REPO_ROOT,
    maxBuffer: 1 << 28,
    ...(stdin !== undefined ? { input: JSON.stringify(stdin) } : {})
  });

describe("shape1 CLI", () => {
  test("check --input: blocked exits 1, owed exits 0, core JSON has no messages", () => {
    const r1 = cli(["check", "--input", "-", "--core"], ex1("B"));
    expect(r1.status).toBe(1);
    const out = JSON.parse(r1.stdout.toString()) as {
      verdict: string;
      obligations: { message?: string; key: string }[];
    };
    expect(out.verdict).toBe("blocked");
    expect(out.obligations[0]?.message).toBeUndefined();
    expect(out.obligations[0]?.key.startsWith("ob:bb51a88f52f5081e")).toBe(true);
    expect(cli(["check", "--input", "-"], ex4()).status).toBe(0);
  });
  test("malformed input exits 2 (invalid)", () => {
    const r = cli(["check", "--input", "-", "--json"], { ...ex1("B"), now: "yesterday" });
    expect(r.status).toBe(2);
    expect((JSON.parse(r.stdout.toString()) as { verdict: string }).verdict).toBe("invalid");
  });
  test("a 0.x fixture through inspect, migration, synthesized code and the decider", () => {
    const fx = join(REPO_ROOT, "fixtures/loosening/rule_removed");
    const r = cli([
      "check",
      "--model",
      join(fx, "head"),
      "--base",
      join(fx, "base"),
      "--synthesize",
      "--maintainer",
      "alice",
      "--maintainer",
      "bob",
      "--now",
      "2026-10-25T12:00:00Z",
      "--json"
    ]);
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout.toString()) as {
      loosening: { question: string; final: boolean; exploited: boolean }[];
    };
    expect(out.loosening.some((l) => l.question === "L1" && l.final && l.exploited)).toBe(true);
  });
  test("ρ rule-3 hints (A.8.1.6): a bare rename is undecided; a rename that also narrows is loosened", () => {
    const run = (name: string) => {
      const fx = join(REPO_ROOT, "fixtures/loosening", name);
      const r = cli([
        "check",
        "--model",
        join(fx, "head"),
        "--base",
        join(fx, "base"),
        "--synthesize",
        "--maintainer",
        "alice",
        "--maintainer",
        "bob",
        "--now",
        "2026-10-25T12:00:00Z",
        "--json"
      ]);
      return JSON.parse(r.stdout.toString()) as {
        loosening: { question: string; answer: string; exploited: boolean; final: boolean }[];
      };
    };
    const a = run("renamed_component").loosening;
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((l) => l.answer === "undecided")).toBe(true);
    const b = run("renamed_component_and_narrowed_rule").loosening;
    expect(b.some((l) => l.question === "L3" && l.answer === "loosened" && l.exploited)).toBe(true);
    const c = run("resource_renamed_trait_kept").loosening;
    expect(c.every((l) => l.answer === "undecided")).toBe(true);
    const d = run("resource_renamed_trait_dropped").loosening;
    expect(
      d.some((l) => l.question === "L1" && l.answer === "loosened" && l.final && l.exploited)
    ).toBe(true);
  });
  test("human rendering shows causes and dischargers", () => {
    const r = cli(["check", "--input", "-"], ex1("B"));
    const text = r.stdout.toString();
    expect(text).toContain("verdict: blocked");
    expect(text).toContain("caused by:");
    expect(text).toContain("1. edit-code (author, agent-safe)");
  });
  test("keygen is deterministic", () => {
    expect(cli(["keygen", "--seed", "01"]).stdout.toString()).toBe(
      cli(["keygen", "--seed", "01"]).stdout.toString()
    );
  });
});
