"""Glob matching with proto/src/globs.ts semantics (** / **/ / * / ?), shared by the H5 scripts."""
import re


def glob_re(g):
    out = ""
    i = 0
    while i < len(g):
        c = g[i]
        if g.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
            continue
        if g.startswith("**", i):
            out += ".*"
            i += 2
            continue
        if c == "*":
            out += "[^/]*"
        elif c == "?":
            out += "."
        else:
            out += re.escape(c)
        i += 1
    return re.compile("^" + out + "$", re.S)


def in_globs(globs, path):
    return any(glob_re(g).match(path) for g in globs)
