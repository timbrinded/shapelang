#!/usr/bin/env python3
"""Run every A3 injection: check mode, run mode (observing effects) and --verdict.

usage: python3 -I run.py <injections-dir> <obs-dir> <tcp-port> <out.tsv>
Needs Lean on PATH for --verdict. Effects are observed through stdout
("EFFECT:"), files under <obs-dir>, a TCP listener on <tcp-port>, wall time
(sleep) and the exit code (exit/die).
"""
import os, socket, subprocess, sys, threading, time

BEND = os.environ.get("BEND", "/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/bendc/bend")
inj, obs, port, outp = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
conns = []

def listen():
    s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("127.0.0.1", port)); s.listen(16)
    while True:
        c, _ = s.accept(); conns.append(time.time()); c.close()

threading.Thread(target=listen, daemon=True).start()
time.sleep(0.3)
env = {**os.environ, "BEND_NO_TELEMETRY": "1"}

def run(args, t):
    s = time.time()
    try:
        r = subprocess.run([BEND] + args, capture_output=True, text=True, env=env, timeout=t)
        return r.returncode, (r.stdout + r.stderr), time.time() - s
    except subprocess.TimeoutExpired as e:
        return "timeout", ((e.stdout or b"").decode() if isinstance(e.stdout, bytes) else (e.stdout or "")), time.time() - s

def first_err(out):
    ls = [l.strip() for l in out.splitlines()]
    for p in ("- message", "- expected", "Error"):
        for i, l in enumerate(ls):
            if l.startswith(p):
                if p == "- expected" and i + 1 < len(ls) and ls[i+1].startswith("- observed"):
                    return l + " | " + ls[i+1]
                return l
    return ls[0] if ls else ""

rows = []
for k in sorted(os.listdir(inj)):
    m = os.path.join(inj, k, "main.bend")
    f = os.path.join(obs, k + ".file")
    if os.path.exists(f):
        os.remove(f)
    rc_c, out_c, _ = run([m, "--check-only"], 120)
    check = "PASS" if out_c.startswith("ALL PROOFS CHECK") else "FAIL"
    n0 = len(conns)
    rc_r, out_r, secs = run([m], 20)
    time.sleep(0.2)
    effects = []
    if "EFFECT:" in out_r and not out_r.startswith("SOME PROOFS FAIL"): effects.append("stdout")
    if os.path.exists(f): effects.append("file")
    if len(conns) > n0: effects.append("tcp")
    rc_v, out_v, _ = run([m, "--verdict"], 120)
    verdict = "PASS" if out_v.startswith("ALL PROOFS CHECK") else "FAIL"
    runout = " / ".join(l for l in out_r.strip().splitlines()[:3])
    rows.append([k, check, first_err(out_c) if check == "FAIL" else "", str(rc_r), "%.1f" % secs,
                 ",".join(effects) or "-", runout[:160], verdict, first_err(out_v) if verdict == "FAIL" else ""])
    print("\t".join(rows[-1])); sys.stdout.flush()

with open(outp, "w") as fh:
    fh.write("\t".join(["id", "check", "check_error", "run_exit", "run_secs", "effects_observed", "run_output", "verdict", "verdict_error"]) + "\n")
    for r in rows:
        fh.write("\t".join(r) + "\n")
