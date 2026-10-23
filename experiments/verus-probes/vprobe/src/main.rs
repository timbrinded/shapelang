// vprobe: extract per-function contract/body fingerprints and trust markers
// from Verus source files. Usage: vprobe FILE... ; prints one JSON line per file.
use proc_macro2::{TokenStream, TokenTree};
use quote::ToTokens;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::str::FromStr;
use verus_syn::spanned::Spanned;
use verus_syn::visit_mut::VisitMut;
use verus_syn::{Expr, FnMode, ImplItem, Item, Signature, TraitItem, UnOp};

// Canonical text without commas, so trailing-comma edits by verusfmt do not
// change a fingerprint.
fn canon(ts: &TokenStream, out: &mut String) {
    for t in ts.clone() {
        match t {
            TokenTree::Group(g) => {
                let (o, c) = match g.delimiter() {
                    proc_macro2::Delimiter::Parenthesis => ("(", ")"),
                    proc_macro2::Delimiter::Brace => ("{", "}"),
                    proc_macro2::Delimiter::Bracket => ("[", "]"),
                    proc_macro2::Delimiter::None => ("", ""),
                };
                out.push_str(o);
                out.push(' ');
                canon(&g.stream(), out);
                out.push_str(c);
                out.push(' ');
            }
            TokenTree::Punct(p) if p.as_char() == ',' => {}
            other => {
                out.push_str(&other.to_string());
                out.push(' ');
            }
        }
    }
}

fn h(ts: &TokenStream) -> String {
    let mut s = String::new();
    canon(ts, &mut s);
    let mut d = Sha256::new();
    d.update(s.as_bytes());
    hex::encode(&d.finalize()[..8])
}

fn count(ts: &TokenStream) -> usize {
    ts.clone()
        .into_iter()
        .map(|t| match t {
            TokenTree::Group(g) => 1 + count(&g.stream()),
            _ => 1,
        })
        .sum()
}

fn idents(ts: &TokenStream, out: &mut BTreeSet<String>) {
    for t in ts.clone() {
        match t {
            TokenTree::Group(g) => idents(&g.stream(), out),
            TokenTree::Ident(i) => {
                out.insert(i.to_string());
            }
            // `x@` is sugar for `x.view()`, so record the spec fn it names.
            TokenTree::Punct(p) if p.as_char() == '@' => {
                out.insert("view".to_string());
            }
            _ => {}
        }
    }
}

fn mode_name(m: &FnMode) -> &'static str {
    match m {
        FnMode::Spec(_) => "spec",
        FnMode::SpecChecked(_) => "spec",
        FnMode::Proof(_) => "proof",
        FnMode::ProofAxiom(_) => "axiom",
        FnMode::Exec(_) => "exec",
        FnMode::Default => "exec",
    }
}

// Removes ghost code from an exec body: assert/assume/assert-forall, proof
// blocks, and loop invariants/ensures/decreases. Ghost lets are not removed.
struct GhostEraser;
impl VisitMut for GhostEraser {
    fn visit_expr_mut(&mut self, e: &mut Expr) {
        let erase = match e {
            Expr::Assert(_) | Expr::AssertForall(_) | Expr::Assume(_) => true,
            Expr::Unary(u) => matches!(u.op, UnOp::Proof(_)),
            _ => false,
        };
        if erase {
            *e = Expr::Verbatim(TokenStream::new());
            return;
        }
        match e {
            Expr::While(w) => {
                w.invariant = None;
                w.invariant_except_break = None;
                w.invariant_ensures = None;
                w.ensures = None;
                w.decreases = None;
            }
            Expr::Loop(l) => {
                l.invariant = None;
                l.invariant_except_break = None;
                l.invariant_ensures = None;
                l.ensures = None;
                l.decreases = None;
            }
            Expr::ForLoop(f) => {
                f.invariant = None;
                f.decreases = None;
            }
            _ => {}
        }
        verus_syn::visit_mut::visit_expr_mut(self, e);
    }
}

fn attr_flags(attrs: &[verus_syn::Attribute]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for a in attrs {
        let s = a.to_token_stream().to_string().replace(' ', "");
        for k in [
            "external_body",
            "external_fn_specification",
            "external_type_specification",
            "uninterp",
            "opaque",
        ] {
            if s.contains(k) {
                out.insert(k.to_string());
            }
        }
        if s.contains("verifier::external]") || s.contains("verifier(external)") {
            out.insert("external".into());
        }
    }
    out
}

fn pos(span: proc_macro2::Span) -> [usize; 4] {
    let (a, b) = (span.start(), span.end());
    [a.line, a.column, b.line, b.column]
}

fn clause_spans(spec: Option<&verus_syn::Specification>) -> Vec<[usize; 4]> {
    spec.map(|s| s.exprs.iter().map(|e| pos(e.span())).collect()).unwrap_or_default()
}

// Features of a signature that bound (or fail to bound) what the function can write.
fn sig_features(sig: &Signature, block: Option<&verus_syn::Block>) -> Value {
    let mut inputs = TokenStream::new();
    for a in &sig.inputs {
        a.to_tokens(&mut inputs);
    }
    let toks = flat(&inputs);
    let has = |w: &str| toks.iter().any(|t| t == w);
    let mut_ref = toks.windows(2).any(|w| w[0] == "&" && w[1] == "mut");
    let raw = toks.windows(2).any(|w| w[0] == "*" && (w[1] == "mut" || w[1] == "const"))
        || ["PPtr", "PCell", "PointsTo", "RawPtr", "PointsToRaw", "PAtomicU64", "PAtomicUsize"].iter().any(|w| has(w));
    let interior = toks.iter().any(|t| {
        ["Cell", "RefCell", "UnsafeCell", "Mutex", "RwLock", "Arc", "Rc", "OnceCell"].contains(&t.as_str()) || t.starts_with("Atomic")
    });
    let tracked = has("Tracked");
    let unsafe_body = block.map(|b| flat(&b.to_token_stream()).iter().any(|t| t == "unsafe")).unwrap_or(false);
    let mut ens = TokenStream::new();
    if let Some(e) = &sig.spec.ensures {
        e.to_tokens(&mut ens);
    }
    let et = flat(&ens);
    let two_state = et.iter().any(|t| t == "old" || t == "final");
    json!({"mut_ref": mut_ref, "raw": raw, "interior": interior, "tracked": tracked,
           "unsafe_body": unsafe_body || sig.unsafety.is_some(), "two_state": two_state})
}

fn flat(ts: &TokenStream) -> Vec<String> {
    let mut out = Vec::new();
    for t in ts.clone() {
        match t {
            TokenTree::Group(g) => out.extend(flat(&g.stream())),
            other => out.push(other.to_string()),
        }
    }
    out
}

struct Ctx {
    in_verus: bool,
    path: Vec<String>,
    fns: Vec<Value>,
    seen: BTreeMap<String, usize>,
}

impl Ctx {
    fn add_fn(&mut self, attrs: &[verus_syn::Attribute], sig: &Signature, block: Option<&verus_syn::Block>, owner: &str) {
        // Only items inside a verus! macro are verified; plain Rust is ignored.
        if !self.in_verus {
            return;
        }
        let mut key = self.path.clone();
        if !owner.is_empty() {
            key.push(owner.to_string());
        }
        key.push(sig.ident.to_string());
        let mut key = key.join("::");
        let n = self.seen.entry(key.clone()).or_insert(0);
        *n += 1;
        if *n > 1 {
            key = format!("{key}#{n}");
        }
        let mut contract_sig = sig.clone();
        contract_sig.spec.decreases = None;
        contract_sig.spec.prover = None;
        let contract_ts = contract_sig.to_token_stream();
        let mut clause_ts = TokenStream::new();
        let s = &sig.spec;
        if let Some(r) = &s.requires { r.to_tokens(&mut clause_ts); }
        if let Some(r) = &s.recommends { r.to_tokens(&mut clause_ts); }
        if let Some(r) = &s.ensures { r.to_tokens(&mut clause_ts); }
        if let Some(r) = &s.default_ensures { r.to_tokens(&mut clause_ts); }
        if let Some(r) = &s.returns { r.to_tokens(&mut clause_ts); }
        let mut cids = BTreeSet::new();
        idents(&contract_ts, &mut cids);
        let (body_h, body_n, exec_h, exec_n, bids, assume_n, admit_n) = match block {
            Some(b) => {
                let bt = b.to_token_stream();
                let mut erased = b.clone();
                GhostEraser.visit_block_mut(&mut erased);
                let et = erased.to_token_stream();
                let mut bids = BTreeSet::new();
                idents(&bt, &mut bids);
                let (a, ad) = scan_assume(&bt);
                (h(&bt), count(&bt), h(&et), count(&et), bids, a, ad)
            }
            None => (String::new(), 0, String::new(), 0, BTreeSet::new(), 0, 0),
        };
        self.fns.push(json!({
            "key": key,
            "mode": mode_name(&sig.mode),
            "flags": attr_flags(attrs),
            "contract_h": h(&contract_ts),
            "contract_txt": if std::env::var("VPROBE_TEXT").is_ok() { let mut t = String::new(); canon(&contract_ts, &mut t); t } else { String::new() },
            "clause_n": count(&clause_ts),
            "clause_h": h(&clause_ts),
            "contract_n": count(&contract_ts),
            "body_h": body_h,
            "body_n": body_n,
            "exec_h": exec_h,
            "exec_n": exec_n,
            "cids": cids,
            "bids": if matches!(sig.mode, FnMode::Spec(_) | FnMode::SpecChecked(_)) { bids } else { BTreeSet::new() },
            "assume": assume_n,
            "admit": admit_n,
            "sig_feat": sig_features(sig, block),
            "span": [sig.fn_token.span.start().line, block.map(|b| b.brace_token.span.close().end().line).unwrap_or(0)],
            "body_open": block.map(|b| { let p = b.brace_token.span.open().start(); [p.line, p.column] }),
            "body_close": block.map(|b| { let p = b.brace_token.span.close().end(); [p.line, p.column] }),
            "sig_start": [sig.fn_token.span.start().line, sig.fn_token.span.start().column],
            "requires_spans": clause_spans(sig.spec.requires.as_ref().map(|r| &r.exprs)),
            "ensures_spans": clause_spans(sig.spec.ensures.as_ref().map(|r| &r.exprs)),
        }));
    }

    fn items(&mut self, items: &[Item]) {
        for it in items {
            match it {
                Item::Fn(f) => self.add_fn(&f.attrs, &f.sig, Some(&f.block), ""),
                Item::Impl(i) => {
                    let mut owner = i.self_ty.to_token_stream().to_string().replace(' ', "");
                    if let Some((_, p, _)) = &i.trait_ {
                        owner = format!("<{} as {}>", owner, p.to_token_stream().to_string().replace(' ', ""));
                    }
                    for ii in &i.items {
                        if let ImplItem::Fn(f) = ii {
                            let mut attrs = f.attrs.clone();
                            attrs.extend(i.attrs.iter().cloned());
                            self.add_fn(&attrs, &f.sig, Some(&f.block), &owner);
                        }
                    }
                }
                Item::Trait(t) => {
                    let owner = format!("trait {}", t.ident);
                    for ti in &t.items {
                        if let TraitItem::Fn(f) = ti {
                            self.add_fn(&f.attrs, &f.sig, f.default.as_ref(), &owner);
                        }
                    }
                }
                Item::Mod(m) => {
                    if let Some((_, inner)) = &m.content {
                        self.path.push(m.ident.to_string());
                        self.items(inner);
                        self.path.pop();
                    }
                }
                Item::Macro(m) => {
                    let name = m.mac.path.segments.last().map(|s| s.ident.to_string()).unwrap_or_default();
                    if name == "verus" {
                        match verus_syn::parse2::<verus_syn::File>(m.mac.tokens.clone()) {
                            Ok(f) => {
                                let was = self.in_verus;
                                self.in_verus = true;
                                self.items(&f.items);
                                self.in_verus = was;
                            }
                            Err(_) => self.fns.push(json!({"parse_error_in_verus_macro": true})),
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

fn scan_assume(ts: &TokenStream) -> (usize, usize) {
    let toks: Vec<TokenTree> = ts.clone().into_iter().collect();
    let (mut a, mut ad) = (0, 0);
    for (i, t) in toks.iter().enumerate() {
        match t {
            TokenTree::Group(g) => {
                let (x, y) = scan_assume(&g.stream());
                a += x;
                ad += y;
            }
            TokenTree::Ident(id) => {
                let next_paren = matches!(toks.get(i + 1), Some(TokenTree::Group(g)) if g.delimiter() == proc_macro2::Delimiter::Parenthesis);
                if next_paren && id == "assume" { a += 1; }
                if next_paren && id == "admit" { ad += 1; }
            }
            _ => {}
        }
    }
    (a, ad)
}

// File-level trust markers from the raw token stream (comments excluded).
fn tcb_scan(ts: &TokenStream, out: &mut BTreeMap<&'static str, usize>) {
    let toks: Vec<TokenTree> = ts.clone().into_iter().collect();
    for (i, t) in toks.iter().enumerate() {
        match t {
            TokenTree::Group(g) => {
                // #[verifier(external_body)] style
                tcb_scan(&g.stream(), out);
            }
            TokenTree::Ident(id) => {
                let s = id.to_string();
                let next_paren = matches!(toks.get(i + 1), Some(TokenTree::Group(g)) if g.delimiter() == proc_macro2::Delimiter::Parenthesis);
                let next_is_fn = matches!(toks.get(i + 1), Some(TokenTree::Ident(n)) if n == "fn");
                let prev_is_verifier_path = i >= 3
                    && matches!(&toks[i - 1], TokenTree::Punct(p) if p.as_char() == ':')
                    && matches!(&toks[i - 3], TokenTree::Ident(v) if v == "verifier");
                let key: Option<&'static str> = match s.as_str() {
                    "external_body" => Some("external_body"),
                    "external_fn_specification" => Some("external_fn_specification"),
                    "external_type_specification" => Some("external_type_specification"),
                    "assume_specification" => Some("assume_specification"),
                    "uninterp" => Some("uninterp"),
                    "external" if prev_is_verifier_path || toks.len() == 1 => Some("external"),
                    "assume" if next_paren => Some("assume"),
                    "admit" if next_paren => Some("admit"),
                    "axiom" if next_is_fn => Some("axiom_fn"),
                    _ => None,
                };
                if let Some(k) = key {
                    *out.entry(k).or_insert(0) += 1;
                }
            }
            _ => {}
        }
    }
}

// Collect inherent-impl methods of `ty` (inside verus!) that take `&mut self`.
fn mut_methods<'a>(items: &'a [Item], ty: &str, out: &mut Vec<verus_syn::ImplItemFn>) {
    for it in items {
        match it {
            Item::Impl(i) if i.trait_.is_none() && i.self_ty.to_token_stream().to_string().replace(' ', "") == ty => {
                for ii in &i.items {
                    if let ImplItem::Fn(f) = ii {
                        let mut_recv = f.sig.receiver().map(|r| r.reference.is_some() && r.mutability.is_some()).unwrap_or(false);
                        if mut_recv && matches!(f.sig.mode, FnMode::Exec(_) | FnMode::Default) {
                            out.push(f.clone());
                        }
                    }
                }
            }
            Item::Mod(m) => {
                if let Some((_, inner)) = &m.content {
                    mut_methods(inner, ty, out);
                }
            }
            Item::Macro(m) if m.mac.path.segments.last().map(|s| s.ident == "verus").unwrap_or(false) => {
                if let Ok(f) = verus_syn::parse2::<verus_syn::File>(m.mac.tokens.clone()) {
                    mut_methods(&f.items, ty, out);
                }
            }
            _ => {}
        }
    }
}

// `vprobe obligations FILE TYPE`: print a Verus module that checks the AppendOnly
// obligation (the view of TYPE only grows by extension) for every `&mut self` method.
fn obligations(path: &str, ty: &str) {
    let src = std::fs::read_to_string(path).expect("read");
    let file = verus_syn::parse_file(&src).expect("parse");
    let mut methods = Vec::new();
    mut_methods(&file.items, ty, &mut methods);
    let mut body = String::new();
    for f in &methods {
        let mut args = Vec::new();
        let mut params = Vec::new();
        let mut ok = true;
        for a in f.sig.inputs.iter().skip(1) {
            match &a.kind {
                verus_syn::FnArgKind::Typed(pt) => match &*pt.pat {
                    verus_syn::Pat::Ident(pi) => {
                        args.push(pi.ident.to_string());
                        params.push(format!("{}: {}", pi.ident, pt.ty.to_token_stream()));
                    }
                    _ => ok = false,
                },
                _ => ok = false,
            }
        }
        if !ok {
            body.push_str(&format!("    // skipped {}: unsupported parameter pattern\n", f.sig.ident));
            continue;
        }
        let generics = f.sig.generics.to_token_stream().to_string();
        let requires = f.sig.spec.requires.as_ref().map(|r| r.to_token_stream().to_string()).unwrap_or_default();
        body.push_str(&format!(
            "    // Shape: resource Revision : AppendOnly (forbids HardDelete, Truncate, DropStorage)\n    \
             fn shape_obligation_append_only_{name}{generics}(&mut self{sep}{params})\n        {requires}\n        \
             ensures old(self)@.is_prefix_of(final(self)@),\n    {{\n        self.{name}({args});\n    }}\n\n",
            name = f.sig.ident,
            generics = generics,
            sep = if params.is_empty() { "" } else { ", " },
            params = params.join(", "),
            requires = requires,
            args = args.join(", "),
        ));
    }
    println!("use vstd::prelude::*;\n#[allow(unused_imports)]\nuse crate::*;\n\nverus! {{\n\nimpl {ty} {{\n{body}}}\n\n}} // verus!");
}

// `vprobe tcb-check RUST_FILE SHAPE_FILE`: every function that is trusted
// (external, external_body, or using assume/admit) must be declared in the Shape
// model as an `unsafe` fn whose `source` anchors it. Exit 1 when one is not.
fn tcb_check(rust: &str, shape: &str) -> i32 {
    let src = std::fs::read_to_string(rust).expect("read");
    let model = std::fs::read_to_string(shape).expect("read shape");
    let file = verus_syn::parse_file(&src).expect("parse");
    let mut ctx = Ctx { in_verus: false, path: vec![], fns: vec![], seen: BTreeMap::new() };
    ctx.items(&file.items);
    let mut missing = 0;
    for f in ctx.fns.iter().filter(|v| v.get("key").is_some()) {
        let flags: Vec<String> = serde_json::from_value(f["flags"].clone()).unwrap_or_default();
        let trusted = flags.iter().any(|x| x == "external_body" || x == "external")
            || f["assume"].as_u64().unwrap_or(0) > 0
            || f["admit"].as_u64().unwrap_or(0) > 0;
        if !trusted {
            continue;
        }
        let key = f["key"].as_str().unwrap();
        let anchor = format!("source rust(\"src/lib.rs#{key}\")");
        let declared = model.find(&anchor).map(|i| {
            let rest = &model[i..];
            let end = rest[1..].find("\n  fn ").map(|e| e + 1).unwrap_or(rest.len());
            rest[..end].contains("unsafe effects")
        });
        match declared {
            Some(true) => {}
            Some(false) => {
                missing += 1;
                println!("error: trusted function not declared unsafe\n\n{key} is trusted by Verus (external_body, external, assume or admit), but its Shape fn is not `unsafe`.\nDeclare it `unsafe effects complete {{ ... }}` with reason, expires and requires.\n");
            }
            None => {
                missing += 1;
                println!("error: trusted function missing from Shape model\n\n{key} is trusted by Verus (external_body, external, assume or admit), but no Shape fn has source rust(\"src/lib.rs#{key}\").\nDeclare it as an `unsafe` fn with reason, expires and requires.\n");
            }
        }
    }
    if missing == 0 {
        println!("Trust base check passed.");
        0
    } else {
        1
    }
}

fn main() {
    let argv: Vec<String> = std::env::args().collect();
    if argv.get(1).map(|s| s == "obligations").unwrap_or(false) {
        obligations(&argv[2], &argv[3]);
        return;
    }
    if argv.get(1).map(|s| s == "tcb-check").unwrap_or(false) {
        std::process::exit(tcb_check(&argv[2], &argv[3]));
    }
    for path in std::env::args().skip(1) {
        let src = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(e) => {
                println!("{}", json!({"path": path, "ok": false, "err": e.to_string()}));
                continue;
            }
        };
        let mut tcb = BTreeMap::new();
        let lexed = TokenStream::from_str(&src);
        if let Ok(ts) = &lexed {
            tcb_scan(ts, &mut tcb);
        }
        let has_verus = src.contains("verus!");
        match verus_syn::parse_file(&src) {
            Ok(f) => {
                let mut ctx = Ctx { in_verus: false, path: vec![], fns: vec![], seen: BTreeMap::new() };
                ctx.items(&f.items);
                let macro_errs = ctx.fns.iter().filter(|v| v.get("parse_error_in_verus_macro").is_some()).count();
                let fns: Vec<Value> = ctx.fns.into_iter().filter(|v| v.get("key").is_some()).collect();
                println!("{}", json!({"path": path, "ok": macro_errs == 0, "verus": has_verus, "macro_errs": macro_errs, "lexed": lexed.is_ok(), "tcb": tcb, "fns": fns}));
            }
            Err(e) => {
                println!("{}", json!({"path": path, "ok": false, "verus": has_verus, "lexed": lexed.is_ok(), "tcb": tcb, "err": e.to_string(), "fns": []}));
            }
        }
    }
}
