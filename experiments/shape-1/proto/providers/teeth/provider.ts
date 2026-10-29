// teeth (meta-evidence): runs the closed-form model mutation over a 1.0 shape resolved on a head
// manifest and reports vacuous and redundant claims, unused grants, uncovered change classes and
// law teeth. The report is meta-evidence, not a checker record: the spec's record kinds have no
// slot for it (A.10.5 puts teeth in health). It is wrapped, when asked, in an in-toto Statement
// (SCAI attribute SHAPE_TEETH) whose subjects are the assessed claims and the manifest.
import { STATEMENT_TYPE, SCAI_TYPE, type Statement } from "../../src/manifest.ts";
import { parseRecord, type ParsedRecord, type Signer, signStatement } from "../../src/records.ts";
import type { SourceDoc } from "../../src/source.ts";
import { buildWorld } from "../../src/world.ts";
import { type Manifested, elaborateAt } from "../common.ts";
import { type TeethReport, teeth } from "./mutants.ts";
import { type ValidateResult, validateTeeth } from "./validate.ts";

export const TEETH_VERSION = "0.1.0";

export interface TeethRun {
  report: TeethReport;
  validation: ValidateResult | null;
  errors: string[];
  ms: number;
}

export function runTeeth(o: {
  source: SourceDoc;
  man: Manifested;
  records?: unknown[];
  time: string;
  validate?: number;
  p1Verbs?: string[];
}): TeethRun {
  const t0 = Date.now();
  const esf = elaborateAt(o.source, o.time);
  const world = buildWorld(esf, o.man.index, { side: "h" });
  const parsed = (o.records ?? [])
    .map((r) => parseRecord(r))
    .filter((p): p is ParsedRecord => !("error" in p));
  const observations = parsed.filter(
    (r) => r.shape.kind === "observation" && r.shape.revision === o.man.revision
  );
  const tests = parsed.filter((r) => r.shape.kind === "test");
  const report = teeth({ esf, world, observations, tests, p1Verbs: o.p1Verbs });
  const validation =
    o.validate && o.validate > 0
      ? validateTeeth({
          source: o.source,
          esf,
          world,
          manifest: o.man.statement,
          revision: o.man.revision,
          now: o.time,
          perOp: o.validate
        })
      : null;
  return {
    report,
    validation,
    errors: [...esf.errors, ...world.errors].map((e) => `${e.code} ${e.subject}`),
    ms: Date.now() - t0
  };
}

/** The report as an in-toto Statement (SCAI), optionally DSSE-signed; not a shape.evidence.v1 record. */
export function teethStatement(
  report: TeethReport,
  man: Manifested,
  signer: Signer | null
): unknown {
  const subject: Statement["subject"] = [
    {
      name: `shape:manifest/${man.revision}`,
      digest: { sha256: man.index.root.replace(/^sha256:/, "") }
    }
  ];
  for (const c of report.claims)
    subject.push({ name: `shape:claim/${c.id}`, digest: { sha256: c.fp.replace(/^sha256:/, "") } });
  subject.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const stmt: Statement = {
    _type: STATEMENT_TYPE,
    subject,
    predicateType: SCAI_TYPE,
    predicate: {
      attributes: [{ attribute: "SHAPE_TEETH", conditions: { "shape.kind": "teeth" } }],
      producer: { uri: "shape-1/providers/teeth", annotations: { version: TEETH_VERSION } },
      shape: { ...report, revision: man.revision }
    }
  };
  return signer ? signStatement(stmt, [signer]) : stmt;
}
