#!/usr/bin/env python3
"""Generate the A3 effect injections into a pure def.

usage: python3 -I gen.py <out-dir> <obs-dir> <tcp-port>

The host is `def tag(x: String) -> String` (non-IO return type); main prints
"result=" ++ tag("x"). Each effect is injected in three forms:
  F1 direct: the effect used as a statement / bound result inside the pure def
     (a do IO<String> block, the form a naive edit takes)
  F2 drop:   the IO value is built and dropped (`u = E`)
  F3 cps:    the IO value is applied to a type R and a continuation, as
             IO(A) = forall R. (A -> IO.OP<R>) -> IO.OP<R> allows, and the
             resulting IO.OP<R> is matched in pure code
Plus out-of-band routes (foreign non-IO defs, aliases, structural IO, closures,
@unsafe, Array.fork, host callbacks).
"""
import os, sys

out, obs, port = sys.argv[1], sys.argv[2], sys.argv[3]

def path(k):
    return os.path.join(obs, k + ".file")

EFFECTS = {
    # name: (IO expression, its result type)
    "print": ('IO.print("EFFECT:print")', "Unit"),
    "env": ('IO.get_env("HOME")', "Result<&1, &1, U32 & String, String>"),
    "filewrite": ('File.open("{P}", "w")', "Result<&1, &1, U32 & String, File>"),
    "time": ("IO.now()", "Nat"),
    "sleep": ("IO.sleep(1500)", "Unit"),
    "spawn_process": ('Process.run("touch", ["{P}"], "", 1000, 5000)', "Result<&1, &1, U32 & String, U32 & (String & String)>"),
    "spawn_task": ('IO.spawn(Unit, IO.print("EFFECT:spawned"))', "Unit"),
    "tcp": ('TCP.connect("127.0.0.1", ' + port + ')', "Result<&1, &1, U32 & String, Socket>"),
    "udp": ('UDP.bind("127.0.0.1", 0)', "Result<&1, &1, U32 & String, Socket>"),
    "random": ("IO.random_u32()", "Result<&1, &1, U32 & String, U32>"),
    "exit": ("IO.exit(3)", "Unit"),
    "die": ('IO.die(Unit, 4, "EFFECT:die")', "Unit"),
    "chan": ("Chan.new(Unit, 1)", "Chan(Unit)"),
}

MAIN = '''
def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("result=" ++ tag("x"))
'''

OBSERVE = '''
def observe(-R: Type, op: IO.OP<R>) -> String:
  match op:
    case Emit{v}:
      "Emit"
    case Halt{c, m}:
      "Halt"
    case Exit{c}:
      "Exit"
'''

files = {}

for e, (expr, ty) in EFFECTS.items():
    k1, k2, k3 = "F1_" + e, "F2_" + e, "F3_" + e
    files[k1] = ("import Base\n\ndef tag(x: String) -> String:\n  do IO<String>:\n    r : " + ty + " <- " + expr.replace("{P}", path(k1)) + "\n    return x\n" + MAIN, {})
    files[k2] = ("import Base\n\ndef tag(x: String) -> String:\n  u = " + expr.replace("{P}", path(k2)) + "\n  x\n" + MAIN, {})
    files[k3] = ("import Base\n" + OBSERVE + "\ndef tag(x: String) -> String:\n  observe(Unit, " + expr.replace("{P}", path(k3)) + "(Unit, v => Exit{0})) ++ x\n" + MAIN, {})

# foreign defs with a non-IO type (JS and C)
EJS = "function ffi_tag(x) {\n  require('fs').writeFileSync(%r, 'js');\n  return x;\n}\n\nio_eff(CID(ffi_tag), ffi_tag);\n"
EC = "Term ffi_tag_run(Env e, Term* f, IoWork* w) {\n  FILE* h = fopen(%r, \"w\"); if (h) fclose(h);\n  return f[0];\n}\n\nstatic void __attribute__((constructor)) ffi_tag_use(void) {\n  io_eff(CID(ffi_tag), ffi_tag_run);\n}\n"
files["F1_foreign_js"] = ("import Base\n\ndef ffi_tag(x: String) -> String:\n  import \"./e.js\"\n\ndef tag(x: String) -> String:\n  ffi_tag(x)\n" + MAIN, {"e.js": EJS.replace("%r", repr(path("F1_foreign_js")))})
files["F1_foreign_c"] = ("import Base\n\ndef ffi_tag(x: String) -> String:\n  import \"./e.c\"\n\ndef tag(x: String) -> String:\n  ffi_tag(x)\n" + MAIN, {"e.c": EC.replace("%r", '"' + path("F1_foreign_c") + '"')})
# IO-typed foreign defs, used from the pure def in the three forms
EJS_IO = "function ffi_tag(x) {\n  require('fs').writeFileSync(%r, 'js');\n  return x;\n}\n\nio_eff(CID(ffi_tag), ffi_tag);\n"
for form in ("F1", "F2", "F3"):
    k = form + "_foreign_js_io"
    expr = 'ffi_tag("x")'
    body = {"F1": "  do IO<String>:\n    r : String <- " + expr + "\n    return x\n",
            "F2": "  u = " + expr + "\n  x\n",
            "F3": "  observe(String, " + expr + "(String, v => Exit{0})) ++ x\n"}[form]
    files[k] = ("import Base\n" + (OBSERVE if form == "F3" else "") + "\ndef ffi_tag(x: String) -> IO(String):\n  import \"./e.js\"\n\ndef tag(x: String) -> String:\n" + body + MAIN,
                {"e.js": EJS_IO.replace("%r", repr(path(k)))})

# IO hidden in a closure or a data structure inside the pure def (dropped)
files["F2_closure"] = ('import Base\n\ndef tag(x: String) -> String:\n  f = {u => IO.print("EFFECT:closure") : Unit -> IO(Unit)}\n  x\n' + MAIN, {})
files["F2_data"] = ('import Base\n\ndef tag(x: String) -> String:\n  acts = {[IO.print("EFFECT:list")] : List<IO(Unit)>}\n  x\n' + MAIN, {})
# IO hidden in a closure the pure def calls (the closure returns IO, so the
# call's type is IO and cannot be a String)
files["F1_closure_call"] = ('import Base\n\ndef tag(x: String) -> String:\n  f = {u => IO.print("EFFECT:closure") : Unit -> IO(Unit)}\n  f(Unit{})\n' + MAIN, {})

# Routes with a non-IO-looking signature
files["R1_alias"] = ('import Base\n\n# an alias whose name does not say IO\ndef Pure(-A: Type) -> Type:\n  IO(A)\n\ndef tag(x: String) -> Pure(String):\n  do IO<String>:\n    IO.print("EFFECT:alias")\n    return x\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    s : String <- tag("x")\n    IO.print("result=" ++ s)\n', {})
files["R2_structural"] = ('import Base\n\n# IO(A) spelled out: forall R. (A -> IO.OP<R>) -> IO.OP<R>, uncurried\ndef tag(x: String, -R: Type, k: String -> IO.OP<R>) -> IO.OP<R>:\n  IO.bind(Unit, String, IO.print("EFFECT:structural"), u => IO.pure(String, x))(R, k)\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    s : String <- (R => k => tag("x", R, k) : IO(String))\n    IO.print("result=" ++ s)\n', {})
files["R4_return_closure"] = ('import Base\n\n# return type is a closure type, not IO; the closure yields IO\ndef tag(x: String) -> Unit -> IO(String):\n  u => IO.bind(Unit, String, IO.print("EFFECT:closure-return"), v => IO.pure(String, x))\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    s : String <- tag("x")(Unit{})\n    IO.print("result=" ++ s)\n', {})
files["R4_return_list"] = ('import Base\n\n# return type is a List, not IO; its element is an IO action\ndef tag(x: String) -> List<IO(Unit)>:\n  [IO.print("EFFECT:list-return")]\n\ndef run_all(xs: List<IO(Unit)>) -> IO(Unit):\n  match xs:\n    case Nil{}:\n      IO.pure(Unit, Unit{})\n    case Con{a, rest}:\n      IO.bind(Unit, Unit, a, u => run_all(rest))\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    run_all(tag("x"))\n    IO.print("result=x")\n', {})
files["R5_polymorphic"] = ('import Base\n\n# a polymorphic def: its signature never names IO, the caller instantiates A = IO(Unit)\ndef tag(-A: Type, x: A) -> A:\n  x\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    tag(IO(Unit), IO.print("EFFECT:polymorphic"))\n    IO.print("result=x")\n', {})
files["R6_unsafe_loop"] = ('import Base\n\n@unsafe\ndef spin(x: String) -> String:\n  spin(x)\n\ndef tag(x: String) -> String:\n  spin(x)\n' + MAIN, {})
files["R7_array_fork"] = ('import Base\n\n# Array.fork (an @unsafe Base def) aliases an array: a write through one\n# copy is visible through the other, a hidden mutable cell in pure code\ndef snd_val(r: Array<U32> & U32) -> U32:\n  (a, v) = r\n  v\n\ndef read_b(a2: Array<U32>, b: Array<U32>) -> U32:\n  snd_val(Array.get(U32, b, 0))\n\ndef read0(ab: Array<U32> & Array<U32>) -> U32:\n  (a, b) = ab\n  read_b(Array.set(U32, a, 0, 41), b)\n\ndef tag(x: String) -> String:\n  U32.show(read0(Array.fork(U32, [0 : U32*2n]))) ++ x\n' + MAIN, {})

# positive controls: the same effects performed by an IO main, to show the
# observers see them
CTRL = {
    "print": 'IO.print("EFFECT:print")',
    "filewrite": 'IO.bind(Result<&1, &1, U32 & String, File>, Unit, File.open("{P}", "w"), r => IO.pure(Unit, Unit{}))',
    "spawn_process": 'IO.bind(Result<&1, &1, U32 & String, U32 & (String & String)>, Unit, Process.run("touch", ["{P}"], "", 1000, 5000), r => IO.pure(Unit, Unit{}))',
    "sleep": "IO.sleep(1500)",
    "tcp": 'IO.bind(Result<&1, &1, U32 & String, Socket>, Unit, TCP.connect("127.0.0.1", ' + port + '), r => IO.pure(Unit, Unit{}))',
}
for e, expr in CTRL.items():
    k = "C0_" + e
    files[k] = ("import Base\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    " + expr.replace("{P}", path(k)) + "\n    IO.print(\"result=x\")\n", {})

def main():
    os.makedirs(obs, exist_ok=True)
    for k, (src, extra) in files.items():
        d = os.path.join(out, k)
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "main.bend"), "w").write("# A3 injection " + k + "\n" + src)
        for f, body in extra.items():
            open(os.path.join(d, f), "w").write(body)
    print(len(files), "injections")

main()
