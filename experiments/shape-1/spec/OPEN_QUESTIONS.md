# Open questions

Questions the final package leaves open, as recorded by the crystallize step. Each names what would settle it.

1. dfs_complete is still unproved, so an exhausted L3 verdict rests on 20,000 kernel fuzz instances with 0 disagreements. M2 requires a proof, or 10^5 instances with the open status recorded in A.1.2.
2. Should a manifest identity be mandatory for gates? D27 makes it optional and lists unauthenticated manifests only in health, so T2 and the H5 guarantees hold only over authenticated manifests. How a gate with no signing infrastructure authenticates manifests and records is also open (A.11.6 (9), (23)).
3. Observability is read from the base. A team can therefore avoid coverage by declaring no observer: health shows it, the verdict does not. Should DefaultPolicy block on declared-only claims at critical? To be decided after M5 measures how often it happens.
4. The critic's 'introduce when the law was Sat at base' rule was not adopted, because the checker does not evaluate base laws; the cone of a reason-holding record is used instead. Is the cone enough for providers without deps complete? H3′ measures this without reruns.
5. Under the equal-counterexample clause, randomly seeded counterexamples would make every touch of a failing law blocking. Should equality ignore seeds, or should providers be required to use fixed seeds?
6. A deterministic test that stops at its first failure hides a second bug in a law already failing at base. Is a stricter rule wanted at critical tier, such as blocking any Req edit while the law fails?
7. this.m resolution is static: the enclosing class and its in-tree superclasses only. Dynamic dispatch, subclass overrides and injected services objects stay outside Req closures and call facts; dogfood finding (d) found 29 unresolved calls of this kind.
8. Attribute and derive macros from dependencies (for example serde derives) make Rust identities not hatch-complete, so coverage is raised when they change. Should the registry ship vetted dependency macros, and how often do non-builtin macros occur in Verus code (A.11.6 (10), (20))?
9. Migrating 0.x final forbids lowers them to critical in one-person projects. Is that fidelity loss acceptable, or does 1.0 need a final variant one person can hold? Version 7 rejects the second.
10. The switching change (0.x base, 1.0 head) takes its actors from the head, because a 0.x base has none, and a change over an unreadable base has its L0 owned by the head's shape owner and answered under the head's judges, with no self fallback (A.16.16). Both trade authority for liveness. Should migrate require a base-side actor declaration committed before the switch, and should an unreadable base's L0 need an answerer the last readable base named (A.11.6 (19))?
11. A redaction-tolerant append-only template: AppendOnly now forbids Update, so GDPR redaction needs a weaker, non-final template. Its form is not decided.
12. Hosted statements for TypeScript: test cases are anonymous functions and so not identities, and 45 of 50 testable dogfood laws used one generic Property template.
13. Glob or prefix matching for path-like resource codes: 9 of 26 dogfood fs.path codes are globs, and fs.path is not registered.
14. Manifest-checked resource codes: in H2 N04, renaming a bound ts.type was silent.
15. A claim form for call order inside a body: 5 0.x clauses still have no 1.0 form.
16. DocumentedBy over several documents: the 0.x either-of-N meaning is lost, and 7 bindings became 10 laws.
17. Lockfile and tsconfig registry entries for sub-file implementations: an edit to bun.lock still makes bunTest producer-changed.
18. Plain-Rust unsafe inside Verus-language files (A.11.6 (18)).
19. Kernel performance: a dogfood-size case exceeded 3,600 s against 5–6 s in the prototype. Is M6's budget reachable, or does the kernel stay an offline oracle on sampled cases?
20. H1′'s clean-subset criterion (groups ≤ 0.5) may be out of reach: version 6 gave 0.73 on 22 commits, and only M4's re-migration shows how many historical heads elaborate cleanly.
21. The registry names 'embedded-SQL languages' as carriers of pg.table without listing their members. Should it list them per language, so that providers and checkers agree on which TypeScript code carries SQL channels?
22. Receivers of supplied roots that use structural types: absence soundness at the receiver depends on attributing the effect to the supplier (build/providers). Requiring receivers to be incomplete was rejected as infeasible.
23. TS-embedding registry entries for .astro, .vue, .svelte and .html; the 10^6 L3 budget at 271 components; noise from was hints; the self fallback with several agents; law semantics in Lean; evidence compaction; availability of base observations (A.11.6).
24. Sigstore verification in the reference CLI: it accepts only ed25519 identities today, and records from sigstore(...) identities are rejected (RJ07).
