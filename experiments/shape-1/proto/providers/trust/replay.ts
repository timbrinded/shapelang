// H5 replay over the Verus probes' recorded per-commit data (results/per-commit/*.json.gz): which
// trust events would Shape 1.0 surface, against E9's per-file count-diff baseline (B3)?
//
// Ground truth and filters are E9's (scripts/e9_baselines.py): commits touching Verus files, fewer
// than 10 added files, all parsed; an event is a marker add/remove or an edit to a trusted
// function's body or contract. Shape 1.0 is replayed under three adoption shapes:
//   S0 hatches only:  rule HatchesStayAtBoundaries, boundaries = the *_t.rs files, no surface law;
//                     an event is surfaced iff it adds markers outside a boundary (a new hatch fact).
//   S1 quickstart:    S0 plus `: ReviewedSurface` on the boundaries (judgment at trust citing each
//                     marked identity at unit): also surfaced iff it touches a boundary file (marked
//                     identities' unit digests or the marked set move, so the judgment goes stale).
//   S2 maintained:    boundaries cover every file that held a marker at the base revision (the
//                     inventory kept current): every event is surfaced, by construction.
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

export interface TrustEvent {
  path: string;
  t: boolean;
  add: Record<string, number>;
  remove: Record<string, number>;
  tbody: number;
  tcontract: number;
}

export interface CommitRow {
  commit: string;
  verus_files: number;
  added_files: number;
  parse_fail: number;
  trust_events?: TrustEvent[];
}

export interface ReplayRow {
  repo: string;
  usesT: boolean;
  commits: number;
  withEvent: number;
  b3: number;
  s0: number;
  s1: number;
  s2: number;
  /** commits whose events change no marker count (trusted body or contract edits only) */
  bodyOnly: number;
  /** commits that add markers (hatch growth), and how many each gate surfaces */
  grow: number;
  growB3: number;
  growS0: number;
  growS1: number;
}

const BULK = 10;

export function readPerCommit(path: string): { repo: string; rows: CommitRow[] } {
  const buf = readFileSync(path);
  const text = path.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  return JSON.parse(text) as { repo: string; rows: CommitRow[] };
}

const nonEmpty = (m: Record<string, number>): boolean => Object.values(m).some((n) => n > 0);

export function replayRepo(d: { repo: string; rows: CommitRow[] }): ReplayRow {
  const usesT = d.rows.some((r) => (r.trust_events ?? []).some((e) => e.t));
  const rows = d.rows.filter((r) => r.verus_files > 0 && r.added_files < BULK && r.parse_fail === 0);
  const out: ReplayRow = { repo: d.repo, usesT, commits: rows.length, withEvent: 0, b3: 0, s0: 0, s1: 0, s2: 0, bodyOnly: 0, grow: 0, growB3: 0, growS0: 0, growS1: 0 };
  for (const r of rows) {
    const evs = (r.trust_events ?? []).filter((e) => nonEmpty(e.add) || nonEmpty(e.remove) || e.tbody > 0 || e.tcontract > 0);
    if (evs.length === 0) continue;
    out.withEvent += 1;
    const b3 = evs.some((e) => nonEmpty(e.add) || nonEmpty(e.remove));
    const s0 = evs.some((e) => !e.t && nonEmpty(e.add));
    const s1 = s0 || evs.some((e) => e.t);
    if (b3) out.b3 += 1;
    if (s0) out.s0 += 1;
    if (s1) out.s1 += 1;
    out.s2 += 1;
    if (!b3) out.bodyOnly += 1;
    if (evs.some((e) => nonEmpty(e.add))) {
      out.grow += 1;
      if (b3) out.growB3 += 1;
      if (s0) out.growS0 += 1;
      if (s1) out.growS1 += 1;
    }
  }
  return out;
}

export function replayAll(paths: string[]): { rows: ReplayRow[]; total: Omit<ReplayRow, "repo" | "usesT"> & { withEventT: number; s1T: number } } {
  const rows = paths.map((p) => replayRepo(readPerCommit(p))).sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0));
  const total = { commits: 0, withEvent: 0, b3: 0, s0: 0, s1: 0, s2: 0, bodyOnly: 0, grow: 0, growB3: 0, growS0: 0, growS1: 0, withEventT: 0, s1T: 0 };
  for (const r of rows) {
    total.commits += r.commits;
    total.withEvent += r.withEvent;
    total.b3 += r.b3;
    total.s0 += r.s0;
    total.s1 += r.s1;
    total.s2 += r.s2;
    total.bodyOnly += r.bodyOnly;
    total.grow += r.grow;
    total.growB3 += r.growB3;
    total.growS0 += r.growS0;
    total.growS1 += r.growS1;
    if (r.usesT) {
      total.withEventT += r.withEvent;
      total.s1T += r.s1;
    }
  }
  return { rows, total };
}
