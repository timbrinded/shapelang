// 0.x → 1.0 through `shp inspect --json` (A.11.1) and the 1.0 sidecar merge.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { elaborate } from "../src/elaborate.ts";
import { REPO_ROOT, loadModel } from "../src/loader.ts";
import { extractTraits, mergeSidecar, migrate } from "../src/migrate.ts";
import type { SourceDoc } from "../src/source.ts";

const fx = (name: string, side: "base" | "head"): string => join(REPO_ROOT, "fixtures/loosening", name, side);
const NOW = 1793000000;

describe("migration", () => {
  test("trait bodies are read from 0.x text", () => {
    const t = extractTraits("x.shape", "m", "trait DraftOnly<T: Resource> {\n  forbid final Export<T>\n}\n");
    expect(t).toEqual([{ name: "DraftOnly", module: "m", params: [{ name: "T", kind: "resource" }], forbids: [{ effect: "Export", target: "T", final: true }] }]);
  });
  test("prelude AppendOnly → std::AppendOnly at tier final; units bind their sources; grants → authority", () => {
    const m = loadModel(fx("grant_added", "base"), { maintainers: ["alice", "bob"] });
    const e = elaborate(m.source, { now: NOW });
    expect(e.errors).toEqual([]);
    const forbid = e.claims.find((c) => c.op === "effect.forbid" && String(c.args.atom).startsWith("HardDelete"));
    expect(forbid?.args).toEqual({ atom: "HardDelete<history::Revision>", scope: ["*"], except: [] });
    expect(forbid?.tier).toBe("final");
    expect(e.claims.some((c) => c.op === "authority" && c.args.component === "history::RevisionLog")).toBe(true);
    expect(e.units.find((u) => u.q === "history::RevisionLog.appendRevision")?.bind).toBe("ts:src/history/log.ts#appendRevision");
  });
  test("`rule … when T has Trait` instantiates per bearer; forbid final → tier final", () => {
    const e = elaborate(loadModel(fx("rule_removed", "base"), { maintainers: ["a", "b"] }).source, { now: NOW });
    const f = e.claims.find((c) => c.ids.some((id) => id.startsWith("history::protected_revisions_are_not_deleted")));
    expect(f?.args).toEqual({ atom: "HardDelete<history::Revision>", scope: ["*"], except: [] });
    expect(f?.tier).toBe("final");
  });
  test("implementations give component paths; user trait bodies become templates", () => {
    const e = elaborate(loadModel(fx("governed_directory_moved", "base"), { maintainers: ["a", "b"] }).source, { now: NOW });
    expect(e.components.find((c) => c.q === "sharing::Sharing")?.paths).toEqual(["src/share/**/*.ts"]);
    expect(e.claims.find((c) => c.op === "effect.forbid")?.args.atom).toBe("Export<sharing::PrivateDraft>");
  });
  test("a sidecar declaration replaces the migrated one by (module, decl, name)", () => {
    const base: SourceDoc = { v: "shape.source.v1", modules: [{ module: "m", decls: [{ decl: "component", name: "K" }] }] };
    const side: SourceDoc = { v: "shape.source.v1", modules: [{ module: "m", decls: [{ decl: "component", name: "K", tier: "critical" }, { decl: "shape", name: "S", owner: "T" }] }] };
    const merged = mergeSidecar(base, side);
    expect(merged.modules[0]?.decls).toEqual([{ decl: "component", name: "K", tier: "critical" }, { decl: "shape", name: "S", owner: "T" }]);
  });
  test("migration is deterministic", () => {
    const a = JSON.stringify(loadModel(fx("path_rule_narrowed", "head")).source);
    const b = JSON.stringify(loadModel(fx("path_rule_narrowed", "head")).source);
    expect(a).toBe(b);
    expect(JSON.stringify(migrate({ documents: [], resources: [], components: [], functions: [], relations: [], implementations: [], bindings: [], rules: [], memories: [] }).source.modules.length)).toBe("1");
  });
});
