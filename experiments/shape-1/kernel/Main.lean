import Kernel.Parse
/-! `shapek`: reads a kernel case (JSON) from a file argument or stdin and prints the core
output as JCS. Exit 0 pass/owed, 1 blocked, 2 invalid. -/
open Shape

def main (args : List String) : IO UInt32 := do
  let text ← match args with
    | path :: _ => IO.FS.readFile path
    | [] => (← IO.getStdin).readToEnd
  match J.parse text >>= parseInput with
  | .error msg =>
    IO.println ((J.obj [("contract", .str "shape.check.output/v1"), ("verdict", .str "invalid"),
      ("errors", .arr [.obj [("code", .str "invalid"), ("subject", .str msg)]])]).jcs)
    return 2
  | .ok inp =>
    let out := deriveJ inp
    IO.println out.jcs
    return (if out.strD "verdict" == "blocked" then 1 else 0)
