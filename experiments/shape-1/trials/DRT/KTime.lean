import Kernel.Parse
/-! DRT helper (not part of the kernel): computes one derive stage for one kernel case and prints
its size, so stages can be timed externally: `ktime <stage> case.json`. -/
open Shape

def main (args : List String) : IO UInt32 := do
  let stage := args.head!
  let text ← IO.FS.readFile (args.getD 1 "")
  match J.parse text >>= parseInput with
  | .error msg => IO.println msg; return 2
  | .ok inp =>
    let i := inp.canon
    let e := i.env
    let n : Nat := match stage, e.base with
      | "parse", _ => i.records.length
      | "errors", _ => (errorsOf i).length
      | "eff", _ => (effContras e i.records i.baseRecords).length
      | "struct", _ => (structContras e i.records i.baseRecords).length
      | "conduct", _ => (conductContras e i.records i.baseRecords).length
      | "laws", _ => (lawObs i).length
      | "L1", some Sb => (l1Parts e Sb).length
      | "L2", some Sb => (l2Parts e Sb i.records).length
      | "L3", some Sb => (l3Parts e i.records Sb).length
      | "L4", some Sb => (l4Parts e Sb).length
      | "L7", some Sb => (l7Parts i Sb).length
      | "coverage", _ => (coverageObs e i.records).length
      | "raw", _ => (rawObs i).length
      | "derive", _ => (deriveText inp).length
      | _, _ => 0
    IO.println s!"{stage} {n}"
    return 0
