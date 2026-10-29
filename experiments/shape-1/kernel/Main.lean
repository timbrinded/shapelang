import Kernel
/-! `shapek`: reads a kernel case (`shape.kernel.case/v1`, JSON) from a file argument or stdin
and prints the complete core output (`shape.check.output/v1` core form) as JCS bytes with no
trailing newline (A.16.31). Exit 0 pass/owed, 1 blocked, 2 invalid (malformed case), 3 rejected:
the case is outside the kernel fragment and the output is `shape.kernel.rejected/v1` with the
named reasons (A.11.2.2 [D23]). -/
open Shape

def main (args : List String) : IO UInt32 := do
  let text ← match args with
    | path :: _ => IO.FS.readFile path
    | [] => (← IO.getStdin).readToEnd
  match J.parse text >>= parseInput with
  | .error msg =>
    IO.print ((J.obj [("contract", .str "shape.kernel.rejected/v1"), ("reasons", .arr [.str ("invalid case: " ++ msg)])]).jcs)
    return 2
  | .ok inp =>
    let (out, code) := deriveAll inp
    IO.print out.jcs
    return code.toUInt32
