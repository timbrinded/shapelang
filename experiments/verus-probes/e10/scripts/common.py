"""Shared helpers for the E10 model-level mutation experiment.

Model facts come from `shp inspect --json` run on the pristine copy; text
positions for edits come from a line scan of the authored .shape files.
"""
import json
import os
import re
import subprocess

EXP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRISTINE = os.path.join(EXP, "shape")
CLI = os.path.join(os.environ.get("SHAPELANG_DIR", "/home/user/shapelang"), "packages/shp-cli/src/index.ts")
INSPECT = os.path.join(EXP, "inspect_full.json")

EFFECTS = ["Read", "Append", "Update", "Redact", "LogicalDelete", "HardDelete",
           "Truncate", "DropStorage", "Export", "Import"]


def load_model():
    with open(INSPECT) as f:
        return json.load(f)


def short(qid):
    return qid.split("::", 1)[1] if "::" in qid else qid


def read_lines(relpath, root=PRISTINE):
    with open(os.path.join(root, os.path.relpath(relpath, "shape"))) as f:
        return f.read().split("\n")


COMP_RE = re.compile(r"^component ([A-Za-z_]\w*)\b")
FN_RE = re.compile(r"^  fn ([A-Za-z_]\w*)\b")
EFF_RE = re.compile(r"^    (unsafe )?effects complete \{\s*$")
GRANT_RE = re.compile(r"^  grants ([A-Za-z_]\w*)<([A-Za-z_][\w.:]*)>\s*$")


def scan_authored_file(relpath):
    """Return {component: {"fns": {fn: effects_line_idx}, "grants": [(idx, E, R)]}}."""
    lines = read_lines(relpath)
    out = {}
    comp = None
    fn = None
    for i, line in enumerate(lines):
        m = COMP_RE.match(line)
        if m:
            comp = m.group(1)
            out[comp] = {"fns": {}, "grants": []}
            fn = None
            continue
        if line.startswith("}"):
            comp = None
            fn = None
            continue
        if comp is None:
            continue
        m = FN_RE.match(line)
        if m:
            fn = m.group(1)
            continue
        m = EFF_RE.match(line)
        if m and fn is not None:
            out[comp]["fns"][fn] = i
            continue
        m = GRANT_RE.match(line)
        if m:
            out[comp]["grants"].append((i, m.group(1), m.group(2)))
    return out


def apply_edits(edits, root):
    """Apply edits to files under root/shape. Returns {relpath: pristine_text}."""
    by_file = {}
    for e in edits:
        by_file.setdefault(e["file"], []).append(e)
    saved = {}
    for relpath, es in by_file.items():
        path = os.path.join(root, relpath)
        with open(os.path.join(EXP, relpath)) as f:
            text = f.read()
        saved[relpath] = text
        lines = text.split("\n")
        appends = [e for e in es if e["kind"] == "append"]
        positional = [e for e in es if e["kind"] != "append"]
        # apply positional edits from the bottom up so indices stay valid
        positional.sort(key=lambda e: e["line"], reverse=True)
        for e in positional:
            if e["kind"] == "insert_after":
                lines[e["line"] + 1:e["line"] + 1] = e["text"].split("\n")
            elif e["kind"] == "delete":
                assert lines[e["line"]] == e["expect"], (relpath, e, lines[e["line"]])
                del lines[e["line"]]
            else:
                raise ValueError(e)
        new = "\n".join(lines)
        for e in appends:
            new = new.rstrip("\n") + "\n\n" + e["text"].rstrip("\n") + "\n"
        with open(path, "w") as f:
            f.write(new)
    return saved


def restore(saved, root):
    for relpath, text in saved.items():
        with open(os.path.join(root, relpath), "w") as f:
            f.write(text)


def run_check(root, timeout=600):
    p = subprocess.run(["bun", CLI, "check"], cwd=root, capture_output=True,
                       text=True, timeout=timeout)
    return p.returncode, p.stdout, p.stderr


HEAD_RE = re.compile(r"^(error|warning): (.+)$")


def parse_diagnostics(text):
    """Split checker output into diagnostic blocks."""
    blocks = []
    cur = None
    mode = None
    for line in text.split("\n"):
        m = HEAD_RE.match(line)
        if m:
            cur = {"severity": m.group(1), "kind": m.group(2), "body": [], "caused_by": []}
            blocks.append(cur)
            mode = "body"
            continue
        if cur is None:
            continue
        if line == "caused by:":
            mode = "cause"
            continue
        if mode == "cause" and line.startswith("  - "):
            cur["caused_by"].append(line[4:])
        elif mode == "body" and line.strip():
            cur["body"].append(line)
    return blocks


def cause_claims(block):
    """Extract the claim text from caused-by lines that name rules/traits/components."""
    claims = []
    for c in block["caused_by"]:
        _, _, txt = c.partition(": ")
        if txt.startswith("rule ") or txt.startswith("trait ") or txt.startswith("component "):
            claims.append(txt)
    return claims
