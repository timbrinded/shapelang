#!/usr/bin/env python3
"""Proof size vs code size: non-blank, non-comment lines of main.bend, LAWS.bend
and PROOF.bend per demo, and the def counts.

usage: python3 -I sizes.py <demos-dir> <demo>...
"""
import os, re, sys

def loc(p):
    return sum(1 for l in open(p) if l.strip() and not l.lstrip().startswith("#"))

def defs(p):
    return len(re.findall(r"^(?:def|law) ", open(p).read(), re.M))

print("demo\tcode_loc\tcode_defs\tlaws\tlaw_loc\tproof_loc\tproof_defs\tproof/code")
for d in sys.argv[2:]:
    b = os.path.join(sys.argv[1], d)
    c, l, p = (os.path.join(b, f) for f in ("main.bend", "LAWS.bend", "PROOF.bend"))
    nl = len(re.findall(r"^law ", open(l).read(), re.M))
    print("\t".join(map(str, [d, loc(c), defs(c), nl, loc(l), loc(p), defs(p), "%.2f" % (loc(p) / loc(c))])))
