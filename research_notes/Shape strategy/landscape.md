# Intent governance for agent-written code: the landscape in October 2026

Prepared 2026-10-25 to inform Shape's strategy. "[vendor]" marks a vendor's own claim; "(pre-2025)" marks an older fact. Stars are snapshots; npm/PyPI figures are 30-day downloads read 2026-10-25 (CI-inflated but comparable).

## 1. Spec-driven development (SDD) and agent instruction files

**GitHub Spec Kit.** A chain of Markdown artifacts (constitution → spec → plan → tasks) scaffolded into 40+ agents. It has 142.5K stars and 326 contributors, and its latest release is v1.2.3 (2026-10-22) [SDD Observatory](https://sddobservatory.com/frameworks/spec-kit/). The 1.0 line began 2026-08-21 [review](https://vibecoding.app/blog/spec-kit-review). Every check is an agent prompt. `/speckit.analyze` writes a read-only cross-artifact report. `/speckit.converge` judges the code against the artifacts and may only append tasks [docs](https://github.github.io/spec-kit/reference/agentic-sdd). In October 2026 the maintainers declined a core "flow-back" step for code that runs ahead of its spec, and left spec persistence to extensions [#4940](https://github.com/github/spec-kit/issues/4940). `specify-cli`: ~84K downloads a month [pypistats](https://pypistats.org/packages/specify-cli).

**OpenSpec, BMAD, Conductor, AI-DLC.** OpenSpec (72.6K stars) keeps living capability specs plus archived change folders [SDD Observatory](https://sddobservatory.com/). BMAD (54.4K stars) runs a team of agent personas [SDD Observatory](https://sddobservatory.com/frameworks/bmad-method/). Google's Conductor (2025-12-17) keeps specs and plans as Markdown and now ships as a Claude Code and Antigravity plugin [Google](https://developers.googleblog.com/conductor-introducing-context-driven-development-for-gemini-cli), [repo](https://github.com/gemini-cli-extensions/conductor). AWS AI-DLC v2 moved stage order into code: "code decides which stage runs next; the LLM does the skilled work" [AWS Builder](https://builder.aws.com/content/3GnQs6zaYp4mAx9FWBulDkhWnBo/ai-dlc-v2-core-concepts). All four keep prose artifacts and leave conformance to the LLM.

**AWS Kiro.** Specs (EARS requirements, design, tasks) live in `.kiro/specs/`. Steering is Markdown, and Kiro also reads AGENTS.md [steering](https://kiro.dev/docs/steering). Hooks map IDE events to an agent prompt or a shell command [AWS Builder](https://builder.aws.com/content/3CSqR2TiDguv0Pg6EKn1LLswZ5i/building-production-ready-agents-with-kiro-steering-powers-hooks-specs-and-skills). Two checks are not plain LLM judgment:
- Property-based tests derived from EARS criteria shipped at GA [GA post](https://kiro.dev/blog/general-availability) (GA date 2025-11-17 [Kiro](https://kiro.dev/blog/enterprise-identity-and-usage-metrics/)). They run only in the IDE and are optional by default [AWS Builder](https://builder.aws.com/content/3J3xvomwP3iF4K7U0mFkYLyRTF5/kiro-doesnt-just-write-tests-it-proves-properties).
- Requirements Analysis (2026-05-12): an LLM refines the requirements and translates them into formal logic, then an automated-reasoning engine (an SMT solver, per [The New Stack](https://thenewstack.io/kiro-requirements-analysis-automated-reasoning/)) checks them for consistency and gaps [Kiro](https://kiro.dev/blog/deep-spec-analysis/). The LLM translation step is where trust can break.

Adoption: more than 250K developers during the preview [AWS](https://aws.amazon.com/aws-startups/learn/power-your-startup-with-1-year-of-kiro-pro-plus-now-available-through-aws-startups), with usage "doubling over quarters" [vendor] [Kiro](https://kiro.dev/blog/one-year).

**Tessl.** Its spec-as-source Framework has been in closed beta since 2025-09. After a $125M raise, the product it actually ships became an "Agent Enablement Platform": a skills registry with evals, Snyk scores, required-skill policies, and detection of drifting skill copies [SDD Observatory](https://sddobservatory.com/frameworks/tessl), [docs](https://docs.tessl.io/). It governs context packages, not system intent.

**PDD Kit (Proof-Driven Development; GitHub Next and Microsoft Research).** Research preview since 2026-10-21. An agent proposes a Verus specification, a human approves it, and Verus proves the code meets it "for every input". Where no proof is possible, the kit falls back to tests and computer-use agents. It works on Rust only [GitHub Next](https://x.com/GitHubNext/status/2112936525457740139), [MSR](https://x.com/MSFTResearch/status/2112987215496093979).
- Verus covers a subset of Rust [Verus](https://github.com/verus-lang/verus).
- Its planning host, Chopin, is a prototype whose authors write "We don't recommend you attempt to use it today" [Chopin](https://githubnext.com/projects/chopin).
- Name clash: pdd-kit.dev is an unrelated "Product-Driven Development" kit (v0.37.0) [pdd-kit](https://pdd-kit.dev/).

**Bend 2 `LAWS.bend`.** Released 2026-09-17. Laws are dependent types, the agent writes `PROOF.bend`, and the compiler must check every proof: "LAWS.bend is AGENTS.md backed by proof" [repo](https://github.com/bendlang/bend). Since 2.0.32 a run ends in one verdict, `ALL PROOFS CHECK` or `SOME PROOFS FAIL` [changelog](https://github.com/bendlang/bend/blob/main/CHANGELOG.md). That laws stay fixed is only a line in the recommended prompt ("An accepted law is never deleted or weakened") [bend2.dev](https://bend2.dev/). Adopters add owner review [hackyourworld](https://hackyourworld.com/bend-proof-ai-code-limitations/) or pin the law file's hash in CI [z0intelligence#199](https://github.com/kvnloo/z0intelligence/issues/199). Its 20.2K stars [ai-tldr](https://ai-tldr.dev/releases/bendlang-bend-2/) are mostly Bend 1's.

**AGENTS.md, CLAUDE.md, Cursor.**
- AGENTS.md went to the Linux Foundation's Agentic AI Foundation on 2025-12-09 [LF](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation). 39 of the 100 most-starred repositories had one on 2026-09-01 [dataset](https://github.com/sunxiayi/agents-md-adoption-dataset). A sample found it in about 6% of active repositories [AIB](https://www.aib.vote/en/news/github-agents-md-adoption-sample).
- Claude Code calls instruction files "context, not enforced configuration" and sends enforcement to hooks and `permissions.deny`. It reads AGENTS.md only when no CLAUDE.md is present [docs](https://code.claude.com/docs/en/memory).
- Cursor's `.mdc` rules reach only the agent [docs](https://cursor.com/docs/rules), and Cursor hooks can be LLM "prompt" hooks [docs](https://cursor.com/docs/hooks). Bugbot reads only `BUGBOT.md` [docs](https://cursor.com/docs/bugbot), and averages $1.00–1.50 per run [vendor] [cubic](https://www.cubic.dev/blog/cursor-bugbot-review).
- Context-file linters mainly check that paths and scripts a file mentions still exist [ctxlint](https://github.com/YawLabs/ctxlint), [driftlint](https://github.com/alifurkangokce/driftlint).

**Research.**
- Context files did not generally raise task success and added more than 20% to inference cost [arXiv 2602.11988](https://arxiv.org/abs/2602.11988).
- A study of 266 repositories with sustained SDD use found that 81.5% of spec files have exactly one commit. Practitioners report two kinds of drift: the agent departing from the spec, and the spec going stale as the code changes. Checks "can show that code and spec disagree, but not which is wrong" [arXiv 2608.25202](https://arxiv.org/html/2608.25202v4).
- Agents eroded code structure in 77% of long-horizon trajectories, and prompts asking for quality did not slow the decline [SlopCodeBench](https://arxiv.org/abs/2603.24755).

## 2. Architecture conformance

**Dependency checkers.** All of these are deterministic and read the source.
- **ArchUnit** (Java; 1.5.0 on 2026-08-04 [news](https://www.archunit.org/news), then 1.5.1 [releases](https://github.com/TNG/ArchUnit/releases)) has layer, access and `callMethod` rules, `.because()` rationale text, and `FreezingArchRule` baselines [guide](https://www.archunit.org/userguide/html/000_Index.html). Its TypeScript port, ArchUnitTS 2.5.0 (2026-09-12) [repo](https://github.com/LukasNiessen/ArchUnitTS), gets 252K downloads a month [npm](https://api.npmjs.org/downloads/point/last-month/archunit).
- **dependency-cruiser** has forbidden, allowed, required, reachable and circular rules [rules](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) and a `--baseline` file of known violations [CLI](https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md). It gets 18.8M downloads a month [npm](https://api.npmjs.org/downloads/point/last-month/dependency-cruiser). Baseline entries that no longer match any violation go unnoticed; a shrink-only mode is planned [#1080](https://github.com/sverweij/dependency-cruiser/issues/1080) (2026-09).
- **Nx** `enforce-module-boundaries` checks tag constraints in ESLint. Nx Conformance (Enterprise plan) applies them to any language and adds an "Ensure Owners" rule [Nx](https://nx.dev/docs/features/enforce-module-boundaries), [Conformance](https://nx.dev/docs/reference/conformance/overview). 12.9M downloads a month [npm](https://api.npmjs.org/downloads/point/last-month/@nx/eslint-plugin). `eslint-plugin-boundaries` gets 7.0M [npm](https://api.npmjs.org/downloads/point/last-month/eslint-plugin-boundaries).
- **import-linter** has forbidden, layers, independence, protected (2025-09) and acyclic-siblings (2025-11) contracts. Since 2026-08-28 a contract can carry `broken_contract_guidance` that explains how to fix a break [notes](https://import-linter.readthedocs.io/en/stable/release_notes). 21.2M downloads a month [pypistats](https://pypistats.org/packages/import-linter). Tach: 4.6M [pypistats](https://pypistats.org/packages/tach).

**Graph and DSL platforms.** jQAssistant writes rules as Cypher queries over a Neo4j graph of the code, including call edges, under GPLv3 [manual](https://jqassistant.github.io/jqassistant/current), [guide](https://neo4j.com/graphgists/jqassistant-demo-guide). Sonargraph has an architecture DSL for Java, Kotlin, C#, Python, Go, TypeScript and C/C++ [hello2morrow](https://www.hello2morrow.com/products/sonargraph). Its Zügel MCP server (2026-07) checks each dependency an agent proposes "before code is written" and tracks every edit against baselines [blog](https://blog.hello2morrow.com/2026/07/sonargraph-mcp-2/).

**Models and catalogs.** These describe a system; none of them checks the code.
- The Structurizr DSL builds the C4 rules into the model and ships a free MCP server [Structurizr](https://structurizr.com/).
- LikeC4 (5.9K stars) adds an MCP server and a Model API for custom rules over the model [LikeC4](https://likec4.dev/), [API](https://likec4.dev/tooling/model-api).
- Backstage (CNCF incubating since 2022, pre-2025) harvests ownership from YAML files [CNCF](https://www.cncf.io/projects/backstage), [catalog](https://backstage.io/docs/features/software-catalog). A new `AiResource` kind catalogs skills and governance rules with their owners [docs](https://backstage.io/docs/ai/ai-in-the-catalog).

**ADR tooling.**
- MADR 4.0 (2024-09, pre-2025) is a template only [MADR](https://adr.github.io/madr/).
- Archgate (created 2026-02-23, Apache-2.0, a TypeScript CLI tagged Bun, 66 stars) pairs each ADR with a `.rules.ts` file that `archgate check` runs in CI and in agent hooks [repo](https://github.com/archgate/cli), [rules](https://docs.archgate.dev/concepts/rules/), [inspect](https://inspect.software/software/archgate/cli). It claims to catch "80% of violations" [vendor] [product](https://archgate.dev/product).
- adr-kit (created 2026-04, MIT, pre-1.0) checks each commit against the declarative `forbid_import`, `forbid_pattern` and `require_pattern` rules in its ADRs, plus supersession, a staleness "guardian", and an optional LLM judge on the host agent's model [repo](https://github.com/rvdbreemen/adr-kit).

**Capability analysis.** Capslock (2023, pre-2025) derives what Go packages can do (network, files, exec) from their call graphs [repo](https://github.com/google/capslock). Fewer than 2% of version updates add a new capability [deps.dev](https://blog.deps.dev/capslock) (2024, pre-2025). The Rust port is experimental [cargo-capslock](https://github.com/rustfoundation/cargo-capslock).

**What these tools cannot express.**
- Import tools see edges only [dependency-cruiser](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md), [import-linter](https://import-linter.readthedocs.io/en/stable/contract_types/).
- ArchUnit, jQAssistant and Sonargraph can approximate effects as call rules, but only within one language and only where an effect maps to a known API (sources above).
- No tool has a cross-language vocabulary of resources, effects, grants and traits whose forbids cannot be waived.
- Capability analysis sees standard-library effects, not domain resources [Capslock](https://github.com/google/capslock/blob/main/docs/capabilities.md).
- Rationale appears as rule text (`.because()`, `broken_contract_guidance`) or ADR prose, and only Archgate and adr-kit tie it to checks, at the level of imports and regex patterns.

## 3. White space, and where Shape stands

**What nobody does well.**
1. **Governing changes to the intent itself.** SDD tools treat a spec edit like any other edit, and Spec Kit kept a fix out of its core (#4940 above). Bend relies on a prompt and owner review. Baselines go stale without anyone noticing (#1080). The only close analogues guard tests: checkwash flags weakened tests deterministically, without an LLM [PyPI](https://pypi.org/project/checkwash/0.6.0/), and OWASP recommends CI checks and CODEOWNERS against the same habit [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Coding_with_AI_Cheat_Sheet.html). Shape's rule-loosening gate fails a pull request whose own rule edits are what let it pass, unless the PR body gives a reason [workflow](../../.github/workflows/shape-loosening.yml). We found no counterpart in architecture tooling.
2. **Domain effects and authority.** Unwaivable forbids on resource traits and grants per component ([README](../../README.md)) sit between import linters, which only see syntax, and proof tools (Rust or Bend only, behaviour-level, costly).
3. **Rationale with obligations.** ADR tools attach rules to decisions. None makes a decision required context, or requires a re-evaluation when a guarded target changes ([design rationale](../../docs-site/src/content/docs/inside-shape/design-rationale.md)).
4. **A budget for LLM judgment.** The market splits into fully deterministic tools and all-LLM SDD tools and reviewers. Vendors already treat LLM verdicts as advisory:
   - Claude Code Review never blocks a pull request, and it reads `REVIEW.md` from the base branch [docs](https://code.claude.com/docs/en/code-review).
   - Bugbot's check ends neutral by default, and `bugbot.yaml` is read from the base branch [cubic](https://www.cubic.dev/blog/cursor-bugbot-review).
   - GitHub's agentic-workflows guidance says to keep builds, tests and linting deterministic [gh-aw](https://github.github.com/gh-aw/about).

   Nobody yet offers a deterministic layer that decides which claims an LLM needs to judge again.
5. **Evidence over time.** No tool keeps a history of verdicts per claim. adr-kit's per-ADR advisory verdicts come closest [repo](https://github.com/rvdbreemen/adr-kit).

**Where Shape is redundant or weak.**
- For dependency direction, layers and cycles, the dependency checkers above verify the real code deterministically and have tens of millions of downloads a month. Shape's relation, path and cycle rules verify only what the model declares.
- `shp check` cannot see an effect the model does not declare. So effect claims are only as good as Shape's three Claude jobs (review, guard, index) [workflow](../../.github/workflows/shape.yml). That is the same non-deterministic layer as Claude Code Review and Bugbot, which a plain `REVIEW.md` can steer.
- A typed model maintained by hand is exposed to the same spec decay measured in SDD repositories (arXiv 2608.25202). Prose formats win adoption without any DSL cost: Spec Kit has 142.5K stars [SDD Observatory](https://sddobservatory.com/frameworks/spec-kit/).
- Archgate and adr-kit offer rationale plus deterministic checks over the real source, in familiar Markdown, TypeScript and JSON. Kiro offers SMT-backed requirement checking with AWS distribution.
- Where proof tools apply, they give stronger guarantees. Shape can show that its claims are coherent, not that the code is correct.

**Inference, not sourced fact.** The defensible position is a governance layer over other tools' evidence (import linters, capability analysis, tests, proofs): deterministic claim coherence, unwaivable forbids, loosening control, and a budgeted LLM judge that reads claims from the base branch. Avoid becoming another conformance checker or SDD workflow.
