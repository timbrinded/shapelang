// Laws for c2/modules/log.ts, checked after every operation of a sequence that
// starts from the empty log. Input: a list of operations.
import { listsOver } from "./ranges.mjs";

const snap = (entries) => entries.map((e) => ({ id: e.id, payload: e.payload }));
const sameEntry = (a, b) => a !== undefined && b !== undefined && a.id === b.id && a.payload === b.payload;
const sameEntries = (a, b) => a.length === b.length && a.every((e, i) => sameEntry(e, b[i]));

export function check(mod, ops) {
  let log = mod.empty();
  if (mod.count(log) !== 0 || mod.entries(log).length !== 0) return "the empty log has no entries";
  for (const op of ops) {
    const before = snap(mod.entries(log));
    const n = before.length;
    let next;
    if (op.op === "append") next = mod.append(log, op.payload);
    else if (op.op === "redact") next = mod.redact(log, op.id);
    else next = mod.retain(log, op.keep);
    if (!sameEntries(snap(mod.entries(log)), before)) return "operations do not modify the previous log";
    const after = snap(mod.entries(next));
    if (mod.count(next) !== after.length) return "count agrees with the entries";
    const ids = mod.ids(next);
    if (ids.length !== after.length || ids.some((id, i) => id !== i || after[i].id !== i)) {
      return "ids are the sequence 0..count-1";
    }
    if (after.length < n) return "count never decreases";
    for (let i = 0; i < n; i++) if (after[i].id !== before[i].id) return "ids before are a prefix of ids after";
    if (op.op === "append") {
      if (after.length !== n + 1 || !sameEntry(after[n], { id: n, payload: op.payload })) {
        return "append adds one entry with the payload at the end";
      }
      for (let i = 0; i < n; i++) if (!sameEntry(after[i], before[i])) return "append changes no existing entry";
    } else if (op.op === "redact") {
      if (after.length !== n) return "redact keeps every entry";
      for (let i = 0; i < n; i++) {
        const expected = i === op.id ? { id: i, payload: null } : before[i];
        if (!sameEntry(after[i], expected)) return "redact nulls exactly the named entry";
      }
    } else {
      if (after.length !== n) return "retention keeps every entry";
      for (let i = 0; i < n; i++) {
        const expected = i < n - op.keep ? { id: i, payload: null } : before[i];
        if (!sameEntry(after[i], expected)) return "retention redacts exactly the entries older than the newest keepLast";
      }
    }
    for (let id = 0; id <= after.length + 1; id++) {
      const found = mod.find(next, id);
      if (id < after.length ? !sameEntry(found, after[id]) : found !== undefined) return "find returns the entry with that id";
    }
    log = next;
  }
  return null;
}

export function arbitrary(fc) {
  const op = fc.oneof(
    fc.string({ maxLength: 3 }).map((payload) => ({ op: "append", payload })),
    fc.nat({ max: 32 }).map((id) => ({ op: "redact", id })),
    fc.nat({ max: 32 }).map((keep) => ({ op: "retain", keep }))
  );
  return fc.array(op, { maxLength: 32 });
}

const append = (payload) => ({ op: "append", payload });
const redact = (id) => ({ op: "redact", id });
const retain = (keep) => ({ op: "retain", keep });
const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

// Small scope: payloads a/b, ids and keepLast in 0..5, sequences up to length 4.
export function* smallScope() {
  yield* listsOver([append("a"), append("b"), ...range(0, 5).map(redact), ...range(0, 5).map(retain)], 4);
}

// Large scope: every sequence up to length 6 over a reduced alphabet, then long
// sequences: k appends followed by one or two operations, and append/retain/append.
export function* largeScope() {
  yield* listsOver([append("a"), append("b"), ...range(0, 2).map(redact), ...range(0, 2).map(retain)], 6);
  const tails = [append("t"), redact(0), redact(7), redact(8), redact(9), redact(15), redact(16), retain(0), retain(1), retain(7), retain(8), retain(9)];
  for (let k = 0; k <= 40; k++) {
    const prefix = Array.from({ length: k }, (_, i) => append(`p${i}`));
    for (const tail of [append("x"), ...range(0, k + 1).map(redact), ...range(0, k + 1).map(retain)]) yield [...prefix, tail];
    for (const a of tails) for (const b of tails) yield [...prefix, a, b];
  }
  for (let k = 0; k <= 24; k++) for (let j = 0; j <= 24; j++) for (const m of [0, 1, 8]) {
    yield [...Array.from({ length: k }, () => append("p")), retain(j), ...Array.from({ length: m }, () => append("q"))];
  }
}

export function bigArbitrary(fc) {
  const op = fc.oneof(
    { arbitrary: fc.string({ maxLength: 2 }).map((payload) => ({ op: "append", payload })), weight: 3 },
    { arbitrary: fc.nat({ max: 100 }).map((id) => ({ op: "redact", id })), weight: 1 },
    { arbitrary: fc.nat({ max: 100 }).map((keep) => ({ op: "retain", keep })), weight: 1 }
  );
  return fc.array(op, { maxLength: 100 });
}
