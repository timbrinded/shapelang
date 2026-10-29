"""Loads experiments/shape-1/spec/vectors/vectors.py as a module (its module-level JSON print is discarded)."""
import contextlib, io, types
import os
VECTORS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "spec", "vectors", "vectors.py")
if not os.path.exists(VECTORS):
    VECTORS = "/home/user/shapelang/experiments/shape-1/spec/vectors/vectors.py"
def load():
    src = open(VECTORS, encoding="utf-8").read()
    mod = types.ModuleType("vectors")
    mod.__file__ = VECTORS
    with contextlib.redirect_stdout(io.StringIO()):
        exec(compile(src, VECTORS, "exec"), mod.__dict__)
    return mod
