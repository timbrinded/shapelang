"""E4: seed routing bypasses into IronKV and record which detectors catch them.
Usage: e4_seed.py BASE_TREE OUT_DIR"""
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SBX = os.path.join(HERE, "..", "bin", "sbx")
VPROBE = os.environ.get("VPROBE", os.path.join(HERE, "..", "vprobe", "target", "release", "vprobe"))
base, out = sys.argv[1], sys.argv[2]
EXTRA = ("let bypass_ep = netc.get_my_end_point(); let bypass_msg: Vec<u8> = Vec::new(); "
         "let _ = netc.send_internal_wrapper(&bypass_ep, &bypass_msg);")
SEEDS = {
    # extra unrecorded send from verified code through the trusted wrapper
    "S1_verified_extra_send_via_trusted_wrapper": [("ironsht/src/host_impl_v.rs",
        "        let (ok, events) = send_packet_seq(packets, netc);",
        "        " + EXTRA + "\n        let (ok, events) = send_packet_seq(packets, netc);")],
    # extra send from verified code straight to the external (unverified) function
    "S2_verified_extra_send_via_external_fn": [("ironsht/src/host_impl_v.rs",
        "        let (ok, events) = send_packet_seq(packets, netc);",
        "        let bypass_ep = netc.get_my_end_point(); let bypass_msg: Vec<u8> = Vec::new(); "
        "let _ = unsafe { netc.send_internal(&bypass_ep, &bypass_msg) };\n        let (ok, events) = send_packet_seq(packets, netc);")],
    # bypass in plain Rust outside verus!
    "S3_unverified_fn_outside_verus": [("ironsht/src/host_impl_v.rs", None,
        "\npub fn resend_hint(netc: &mut crate::io_t::NetClient) {\n    " + EXTRA + "\n}\n")],
    # bypass in an #[verifier::external] fn inside verus!
    "S3b_external_fn_inside_verus": [("ironsht/src/net_sht_v.rs", "verus! {",
        "verus! {\n\n#[verifier::external]\npub fn resend_hint(netc: &mut NetClient) {\n    " + EXTRA + "\n}\n")],
    # verified sender switched from the recording API to the raw wrapper
    "S4_verified_send_replaced_by_wrapper": [("ironsht/src/net_sht_v.rs",
        "    match netc.send(&cpacket.dst, &buf)",
        "    match netc.send_internal_wrapper(&cpacket.dst, &buf)")],
}
ALLOWED_CALLERS = {"send"}  # only NetClient::send may call send_internal_wrapper / send_internal_wrapper calls send_internal


def callers_syntactic(tree):
    """Enclosing fn of every textual call to the raw IO functions, across all Rust code."""
    hits = []
    for root, _, files in os.walk(os.path.join(tree, "ironsht/src")):
        for fn in files:
            if not fn.endswith(".rs"):
                continue
            cur = None
            for line in open(os.path.join(root, fn)):
                m = re.search(r"\bfn\s+(\w+)", line)
                if m:
                    cur = m.group(1)
                for target in ("send_internal_wrapper", "send_internal"):
                    if re.search(rf"\.{target}\s*\(", line) and not re.search(rf"fn\s+{target}\b", line):
                        hits.append((fn, cur, target))
    return hits


def callers_verus_graph(dot):
    if not os.path.exists(dot):
        return None
    s = open(dot).read()
    label = dict(re.findall(r'(node_\d+) \[[^\]]*label="Fun\\n([^"]+)"', s))
    edges = re.findall(r"(node_\d+) -> (node_\d+)", s)
    return sorted({label.get(a, a) for a, b in edges if label.get(b, "").endswith(("::send_internal_wrapper", "::send_internal"))})


def tcb(tree):
    files = sorted(os.path.join(dp, f) for dp, _, fs in os.walk(os.path.join(tree, "ironsht/src")) for f in fs if f.endswith(".rs"))
    out = subprocess.run([VPROBE, *files], capture_output=True, text=True).stdout
    tot, trusted = {}, {}
    for line in out.splitlines():
        r = json.loads(line)
        rel = os.path.relpath(r["path"], tree)
        for k, v in r.get("tcb", {}).items():
            tot[k] = tot.get(k, 0) + v
        for f in r["fns"]:
            if set(f["flags"]) & {"external_body", "external"}:
                trusted[(rel, f["key"])] = (f["contract_h"], f["body_h"])
    return tot, trusted


base_tcb, base_trusted = tcb(base)
base_syn = callers_syntactic(base)
results = {}
os.makedirs(out, exist_ok=True)
for name, edits in SEEDS.items():
    tree = os.path.join(out, name)
    shutil.rmtree(tree, ignore_errors=True)
    shutil.copytree(base, tree, ignore=shutil.ignore_patterns("vlog"))
    for path, anchor, text in edits:
        fp = os.path.join(tree, path)
        s = open(fp).read()
        if anchor is None:
            s = s + text
        else:
            assert s.count(anchor) == 1, (name, anchor, s.count(anchor))
            s = s.replace(anchor, text)
        open(fp, "w").write(s)
    proc = subprocess.run([SBX, tree, "--cpus", "2", "--", "verus", "--crate-type=dylib", "--no-report-long-running",
                           "--num-threads", "2", "--smt-option", "smt.random_seed=1", "--log", "call-graph", "--log-dir", "/work/vlog",
                           "ironsht/src/lib.rs"], capture_output=True, text=True)
    errs = [m for m in re.findall(r"^error(?:\[\w+\])?: (.*)", proc.stderr, re.M) if not m.startswith("aborting")]
    t_tcb, t_trusted = tcb(tree)
    tcb_changed = t_tcb != base_tcb or any(t_trusted.get(k) != v for k, v in base_trusted.items()) or set(t_trusted) != set(base_trusted)
    syn = [h for h in callers_syntactic(tree) if h not in base_syn]
    syn_flag = [h for h in syn if h[1] not in ALLOWED_CALLERS]
    graph = callers_verus_graph(os.path.join(tree, "vlog/crate-call-graph-nostd-initial.dot"))
    graph_flag = None if graph is None else [g for g in graph if not g.endswith("::send") and "send_internal_wrapper" not in g]
    results[name] = {
        "D1_verus_rejects": proc.returncode != 0, "verus_errors": errs[:3],
        "D2_tcb_or_trusted_fn_changed": tcb_changed,
        "D3a_verus_callgraph_flags": None if graph is None else bool(graph_flag), "callgraph_callers": graph,
        "D3b_syntactic_callers_flag": bool(syn_flag), "syntactic_new_calls": syn,
        "D4_rust_privacy_rejects": any("private" in e for e in errs),
    }
    print(name, json.dumps({k: v for k, v in results[name].items() if k.startswith("D")}))
json.dump(results, open(os.path.join(out, "results.json"), "w"), indent=1)
