export const concepts = [
  {
    name: "shape-model-loop",
    layout: "sequence",
    title: "Shape review loop",
    summary: "Architecture claims move through human review and deterministic checking.",
    sources: [
      "docs-site/src/content/docs/index.md",
      "docs-site/src/content/docs/learn/what-is-shape.md"
    ],
    steps: [
      { id: "write", label: "Write", detail: ".shape", icon: "fileEdit" },
      { id: "review", label: "Review", detail: "claims", icon: "userCheck" },
      { id: "check", label: "Check", detail: "shp check", icon: "terminal" },
      { id: "gate", label: "Gate", detail: "CI", icon: "shield", tone: "green" },
      { id: "diagnose", label: "Diagnose", detail: "causal trail", icon: "alert", tone: "red" }
    ],
    loopTo: "review",
    note: { text: "rejected → revise the reviewed contract", tone: "red", icon: "flow" },
    reviewTerms: ["Write", "Review", "shp check", "CI", "Diagnose", "revise"]
  },
  {
    name: "quickstart-loop",
    layout: "sequence",
    title: "Your first check",
    summary: "Install Shape, write a model, check it, read diagnostics, and update the model.",
    sources: ["docs-site/src/content/docs/learn/quickstart.md"],
    steps: [
      { id: "install", label: "Install", detail: "shp", icon: "terminal" },
      { id: "shape", label: "Write", detail: "shape/*.shape", icon: "fileEdit" },
      { id: "run", label: "Check", detail: "shp check", icon: "terminal" },
      { id: "read", label: "Read", detail: "diagnostics", icon: "alert", tone: "amber" },
      { id: "update", label: "Update", detail: "model", icon: "flow" }
    ],
    loopTo: "run",
    loopTone: "amber",
    note: { text: "repeat until the check passes • then run it in CI", icon: "check" },
    reviewTerms: ["Install", "shape/*.shape", "shp check", "diagnostics", "model", "CI"]
  },
  {
    name: "first-shape-file-map",
    layout: "hub",
    title: "First Shape file",
    summary: "A component connects a resource, ownership, a function effect, and source evidence.",
    sources: ["docs-site/src/content/docs/learn/first-shape-file.md"],
    center: {
      id: "component",
      label: "Component",
      detail: "AuditStore",
      icon: "hierarchy"
    },
    satellites: [
      {
        id: "resource",
        slot: "north",
        label: "Resource",
        detail: "AuditEvent",
        icon: "database"
      },
      { id: "owns", slot: "west", label: "Ownership", detail: "owns", icon: "shield" },
      {
        id: "function",
        slot: "east",
        label: "Function",
        detail: "appendEvent",
        icon: "code"
      },
      {
        id: "effect",
        slot: "south-west",
        label: "Effect",
        detail: "Append<AuditEvent>",
        icon: "flow",
        tone: "green"
      },
      {
        id: "evidence",
        slot: "south-east",
        label: "Evidence",
        detail: "source ref",
        icon: "link"
      }
    ],
    note: {
      text: "the checker reads declared claims • reviewers inspect the source",
      icon: "search"
    },
    reviewTerms: [
      "Resource",
      "Component",
      "Function",
      "Effect",
      "Evidence",
      "checker reads declared claims"
    ]
  },
  {
    name: "core-vocabulary-map",
    layout: "hub",
    title: "Core vocabulary",
    summary: "Shape connects resources, traits, effects, components, grants, and evidence.",
    sources: [
      "docs-site/src/content/docs/concepts/resources-traits-effects.md",
      "docs-site/src/content/docs/concepts/components-ownership-grants.md"
    ],
    center: {
      id: "component",
      label: "Component",
      detail: "ownership + grants",
      icon: "hierarchy"
    },
    satellites: [
      {
        id: "resource",
        slot: "north",
        label: "Resource",
        detail: "AuditEvent",
        icon: "database"
      },
      {
        id: "trait",
        slot: "west",
        label: "Trait",
        detail: "AppendOnly",
        icon: "shield"
      },
      {
        id: "effect",
        slot: "east",
        label: "Effect",
        detail: "Append<AuditEvent>",
        icon: "flow",
        tone: "green"
      },
      {
        id: "grant",
        slot: "south-west",
        label: "Grant",
        detail: "component permission",
        icon: "check"
      },
      {
        id: "evidence",
        slot: "south-east",
        label: "Evidence",
        detail: "reviewable source",
        icon: "link"
      }
    ],
    note: {
      text: "typed claims describe architecture • not runtime allocation",
      icon: "documentCheck"
    },
    reviewTerms: ["Resource", "Trait", "Effect", "Component", "Grant", "Evidence", "AppendOnly"]
  },
  {
    name: "component-boundary-grants",
    layout: "boundary",
    title: "Component boundary",
    summary:
      "Ownership, grants, and functions live in a component while relations remain external.",
    sources: ["docs-site/src/content/docs/concepts/components-ownership-grants.md"],
    component: {
      id: "component",
      label: "Component",
      icon: "hierarchy",
      items: [
        { label: "owns", detail: "AuditEvent" },
        { label: "grants", detail: "Append<AuditEvent>" },
        { label: "functions", detail: "appendEvent" }
      ]
    },
    external: {
      id: "external",
      label: "AuditEvent",
      detail: "external vertex",
      icon: "database"
    },
    relationLabel: "relation (external)",
    note: { text: "owns names responsibility • not runtime allocation", icon: "shield" },
    reviewTerms: [
      "Component",
      "owns",
      "grants",
      "functions",
      "relation (external)",
      "not runtime allocation"
    ]
  },
  {
    name: "evidence-review-path",
    layout: "sequence",
    title: "Evidence review path",
    summary:
      "A function claim retains its effect, evidence, source reference, and reviewer context.",
    sources: ["docs-site/src/content/docs/concepts/evidence-source-refs.md"],
    steps: [
      { id: "claim", label: "Function claim", detail: "appendEvent", icon: "code" },
      {
        id: "effect",
        label: "Effect",
        detail: "Append<AuditEvent>",
        icon: "flow",
        tone: "green"
      },
      { id: "evidence", label: "Evidence", detail: "supports claim", icon: "link" },
      { id: "source", label: "Source ref", detail: "file#symbol", icon: "source" },
      { id: "review", label: "Reviewer", detail: "checks source", icon: "userCheck" }
    ],
    note: {
      text: "the checker retains provenance • evidence remains a human claim",
      icon: "route"
    },
    reviewTerms: ["Function claim", "Effect", "Evidence", "Source ref", "Reviewer", "provenance"]
  },
  {
    name: "append-only-rejection",
    layout: "decision",
    title: "Why HardDelete is rejected",
    titleHtml: `Why <span class="title-code">HardDelete</span> is rejected`,
    summary: "A final forbid rejects a hard-delete effect even when a component grant exists.",
    sources: ["docs-site/src/content/docs/learn/append-only-walkthrough.md"],
    inputs: [
      {
        id: "claim",
        label: "purgeOldEvents",
        detail: "HardDelete<AuditEvent>",
        icon: "fileCode"
      },
      {
        id: "grant",
        label: "Component grant",
        detail: "allow HardDelete",
        icon: "shield",
        tone: "green"
      },
      {
        id: "ban",
        label: "AppendOnly",
        detail: "forbid final HardDelete",
        icon: "shieldBan",
        tone: "red"
      }
    ],
    decision: { id: "compare", label: "Compare", detail: "claim × rules", icon: "balance" },
    output: {
      id: "reject",
      label: "Rejected",
      detail: "forbidden effect",
      icon: "cancel",
      tone: "red"
    },
    note: { text: "function claim → resource trait → final forbid", icon: "route", tone: "red" },
    reviewTerms: [
      "HardDelete<AuditEvent>",
      "Component grant",
      "AppendOnly",
      "forbid final",
      "Rejected"
    ]
  },
  {
    name: "global-model-review",
    layout: "decision",
    title: "Global model review",
    summary:
      "Architecture changes update the model while unchanged architecture uses a narrow attestation.",
    sources: [
      "docs-site/src/content/docs/learn/global-model-updates.md",
      "docs-site/src/content/docs/concepts/model-updates-attestations.md",
      "docs-site/src/content/docs/learn/ci-workflow.md"
    ],
    inputs: [
      {
        id: "architecture-change",
        label: "Architecture changed",
        detail: "changed files + model update",
        icon: "fileEdit"
      },
      {
        id: "same-architecture",
        label: "No model change",
        detail: "narrow attestation",
        icon: "documentCheck"
      }
    ],
    decision: {
      id: "checks",
      label: "CI checks",
      detail: "coverage + shp check",
      icon: "balance"
    },
    output: {
      id: "ci",
      label: "CI result",
      detail: "pass or reject",
      icon: "check",
      tone: "green"
    },
    note: {
      text: "model update or narrow attestation • effects unknown still blocks strict check",
      icon: "alert",
      tone: "amber"
    },
    reviewTerms: [
      "changed files",
      "Model update",
      "Attestation",
      "Coverage",
      "shp check",
      "CI result"
    ]
  },
  {
    name: "implementation-coverage-map",
    layout: "sequence",
    title: "Implementation coverage",
    summary: "A changed governed file must reach its owning model update or a narrow attestation.",
    sources: ["docs-site/src/content/docs/concepts/implementations-coverage.md"],
    steps: [
      { id: "change", label: "Changed file", detail: "source path", icon: "branch" },
      { id: "binding", label: "Binding", detail: "governed path", icon: "link" },
      { id: "owner", label: "Implementation", detail: "component", icon: "hierarchy" },
      {
        id: "document",
        label: "Document",
        detail: "model update · attestation",
        icon: "fileEdit"
      },
      { id: "gate", label: "Coverage gate", detail: "complete", icon: "shield", tone: "green" }
    ],
    note: {
      text: "coverage checks documentation • not implementation correctness",
      icon: "documentCheck"
    },
    reviewTerms: [
      "Changed file",
      "Binding",
      "Implementation",
      "model update",
      "attestation",
      "Coverage gate"
    ]
  },
  {
    name: "design-memory-reevaluation",
    layout: "decision",
    title: "Design memory",
    summary: "A guarded function change creates a review obligation requiring reevaluation.",
    sources: [
      "docs-site/src/content/docs/concepts/refactor-constraints.md",
      "docs-site/src/content/docs/concepts/model-updates-attestations.md"
    ],
    inputs: [
      { id: "memory", label: "Memory", detail: "known constraint", icon: "audit" },
      { id: "rationale", label: "Rationale", detail: "why it exists", icon: "documentCheck" },
      {
        id: "change",
        label: "Guarded change",
        detail: "guards on_change",
        icon: "branch",
        tone: "amber"
      }
    ],
    decision: {
      id: "obligation",
      label: "Review obligation",
      detail: "modify fn",
      icon: "userCheck"
    },
    output: {
      id: "reevaluation",
      label: "ReEvaluation",
      detail: "reviewed response",
      icon: "check",
      tone: "green"
    },
    note: { text: "not a waiver • final forbids still apply", icon: "shieldBan", tone: "red" },
    reviewTerms: [
      "Memory",
      "Rationale",
      "guards on_change",
      "Review obligation",
      "ReEvaluation",
      "not a waiver"
    ]
  },
  {
    name: "unknowns-safety-states",
    layout: "sequence",
    title: "Unknowns stay visible",
    summary:
      "Unknown effects block strict checking until evidence supports a complete effect summary.",
    sources: ["docs-site/src/content/docs/concepts/unknowns-safety.md"],
    steps: [
      {
        id: "unknown",
        label: "Effects unknown",
        detail: "review blocker",
        icon: "alert",
        tone: "amber"
      },
      { id: "review", label: "Review", detail: "source evidence", icon: "userCheck" },
      {
        id: "complete",
        label: "Effects complete",
        detail: "explicit claim",
        icon: "documentCheck"
      },
      {
        id: "known",
        label: "Known effects",
        detail: "checkable model",
        icon: "check",
        tone: "green"
      }
    ],
    note: {
      text: "memory records known constraints • it does not erase uncertainty",
      icon: "audit"
    },
    reviewTerms: [
      "Effects unknown",
      "review blocker",
      "Effects complete",
      "Known effects",
      "memory"
    ]
  },
  {
    name: "hypercycle-witness-path",
    layout: "cycle",
    title: "Hypercycle witness",
    summary: "Directed calls and callbacks form a cycle that a final graph rule rejects.",
    sources: ["docs-site/src/content/docs/concepts/rules-hypercycles.md"],
    left: { id: "component-a", label: "Component A", detail: "vertex", icon: "hierarchy" },
    right: { id: "component-b", label: "Component B", detail: "vertex", icon: "hierarchy" },
    rule: {
      id: "rule",
      label: "Graph rule",
      detail: "forbid hypercycle",
      icon: "shieldBan",
      tone: "red"
    },
    result: {
      id: "result",
      label: "Rejected",
      detail: "cycle found",
      icon: "cancel",
      tone: "red"
    },
    note: { text: "witness path names each directed relation hop", icon: "route", tone: "red" },
    reviewTerms: [
      "Component A",
      "Component B",
      "calls",
      "callbacks",
      "forbid hypercycle",
      "witness path",
      "Rejected"
    ]
  },
  {
    name: "analyzer-advisory-scan",
    layout: "sequence",
    title: "Analyzer hints",
    summary:
      "The analyzer scans source, compares hints with Shape claims, and emits advisory warnings.",
    sources: ["docs-site/src/content/docs/concepts/analyzer-hints.md"],
    steps: [
      { id: "source", label: "Source scan", detail: "implementation files", icon: "search" },
      {
        id: "hint",
        label: "Destructive hints",
        detail: "DELETE · TRUNCATE · DROP",
        icon: "alert",
        tone: "amber"
      },
      { id: "model", label: "Shape model", detail: "declared effects", icon: "fileCode" },
      { id: "compare", label: "Compare", detail: "hint × claim", icon: "compare" },
      { id: "warning", label: "Warning", detail: "review prompt", icon: "alert", tone: "amber" }
    ],
    note: { text: "advisory only • the .shape model remains the source of truth", icon: "shield" },
    reviewTerms: [
      "Source scan",
      "DELETE",
      "TRUNCATE",
      "DROP",
      "Shape model",
      "Warning",
      "source of truth"
    ]
  },
  {
    name: "diagnostics-causal-trail",
    layout: "sequence",
    title: "Diagnostic causal trail",
    summary:
      "A rejected function claim is explained through its effect, resource, trait, and evidence.",
    sources: ["docs-site/src/content/docs/concepts/diagnostics-provenance.md"],
    steps: [
      { id: "function", label: "Function claim", detail: "purgeOldEvents", icon: "code" },
      { id: "effect", label: "Effect", detail: "HardDelete<AuditEvent>", icon: "flow" },
      { id: "resource", label: "Resource", detail: "AuditEvent", icon: "database" },
      {
        id: "trait",
        label: "Trait constraint",
        detail: "AppendOnly",
        icon: "shieldBan",
        tone: "red"
      },
      {
        id: "diagnostic",
        label: "Diagnostic",
        detail: "forbidden effect",
        icon: "alert",
        tone: "red"
      }
    ],
    note: { text: "every hop retains declaration and source provenance", icon: "route" },
    reviewTerms: [
      "Function claim",
      "Effect",
      "Resource",
      "Trait constraint",
      "Diagnostic",
      "provenance"
    ]
  },
  {
    name: "checker-pipeline",
    layout: "sequence",
    title: "Checker pipeline",
    summary:
      "Shape files are parsed, lowered, evaluated, and formatted into deterministic diagnostics.",
    sources: ["docs-site/src/content/docs/inside-shape/checker-pipeline.md"],
    steps: [
      { id: "source", label: ".shape files", detail: "reviewed claims", icon: "fileCode" },
      { id: "parse", label: "Parse", detail: "text → AST", icon: "code" },
      { id: "lower", label: "Lower", detail: "AST → model", icon: "layers" },
      { id: "rules", label: "Run rules", detail: "facts × constraints", icon: "balance" },
      {
        id: "diagnostic",
        label: "Diagnostics",
        detail: "pass or reject",
        icon: "alert",
        tone: "red"
      }
    ],
    note: {
      text: "deterministic over the declared model • application runtime stays outside",
      icon: "shield"
    },
    reviewTerms: [".shape files", "Parse", "Lower", "Run rules", "Diagnostics", "declared model"]
  },
  {
    name: "fact-lowering-map",
    layout: "sequence",
    title: "Fact lowering",
    summary:
      "Declarations and changes become one effective model with typed indexes, facts, and provenance.",
    sources: ["docs-site/src/content/docs/inside-shape/fact-lowering.md"],
    steps: [
      { id: "declarations", label: "Declarations", detail: "ShapeModule ASTs", icon: "fileCode" },
      { id: "changes", label: "Apply changes", detail: "global model", icon: "branch" },
      { id: "model", label: "Effective model", detail: "typed indexes", icon: "layers" },
      { id: "facts", label: "Facts", detail: "normalized records", icon: "database" },
      { id: "rules", label: "Semantic checks", detail: "diagnostics", icon: "balance" }
    ],
    note: { text: "facts retain provenance • rules do not rescan source text", icon: "route" },
    reviewTerms: [
      "Declarations",
      "Apply changes",
      "Effective model",
      "Facts",
      "Semantic checks",
      "provenance"
    ]
  },
  {
    name: "rule-evaluation-board",
    layout: "sequence",
    title: "Rule evaluation",
    summary: "Rules compare lowered claims and emit stable pass or reject diagnostics.",
    sources: ["docs-site/src/content/docs/inside-shape/rule-evaluation.md"],
    steps: [
      { id: "model", label: "Lowered model", detail: "facts + indexes", icon: "layers" },
      { id: "rules", label: "Rule set", detail: "forbids · grants · coverage", icon: "balance" },
      { id: "context", label: "Context checks", detail: "memory · guards · graph", icon: "audit" },
      { id: "diagnostics", label: "Diagnostics", detail: "causal trail", icon: "route" },
      { id: "result", label: "Pass or reject", detail: "deterministic", icon: "compare" }
    ],
    note: {
      text: "final forbids cannot be waived by grants or design memory",
      icon: "shieldBan",
      tone: "red"
    },
    reviewTerms: [
      "Lowered model",
      "forbids",
      "grants",
      "coverage",
      "memory",
      "Diagnostics",
      "Pass or reject"
    ]
  },
  {
    name: "review-helpers",
    layout: "sequence",
    title: "Review helpers",
    summary:
      "Formatting, checking, editor feedback, and authoring helpers support one human-owned review loop.",
    sources: ["docs-site/src/content/docs/inside-shape/formatter-editor-authoring.md"],
    steps: [
      { id: "draft", label: "Proposed .shape", detail: "effects unknown", icon: "agent" },
      { id: "format", label: "Formatter", detail: "stable diff", icon: "fileEdit" },
      { id: "check", label: "Checker", detail: "semantic truth", icon: "terminal" },
      { id: "editor", label: "Editor APIs", detail: "diagnostics", icon: "code" },
      {
        id: "review",
        label: "Human review",
        detail: "fills evidence",
        icon: "userCheck",
        tone: "green"
      }
    ],
    loopTo: "format",
    loopTone: "amber",
    note: { text: "resolve unknowns • then format and check again", icon: "flow", tone: "amber" },
    reviewTerms: [
      "Proposed .shape",
      "Formatter",
      "Checker",
      "Editor APIs",
      "Human review",
      "effects unknown"
    ]
  },
  {
    name: "shape-boundary",
    layout: "split",
    title: "Shape boundary",
    summary:
      "Shape checks declared model coherence while tests, code review, and runtime proof remain separate.",
    sources: ["docs-site/src/content/docs/learn/what-is-shape.md"],
    inside: {
      title: "Inside Shape",
      icon: "shield",
      items: [
        { label: "Draft claims", detail: "human or agent", icon: "fileEdit" },
        { label: "Review claims", detail: "human judgment", icon: "userCheck" },
        { label: "Check coherence", detail: "deterministic", icon: "terminal" }
      ]
    },
    outside: {
      title: "Outside Shape",
      icon: "cancel",
      items: [
        { label: "Tests remain", detail: "runtime behavior", icon: "check" },
        { label: "Code review remains", detail: "implementation", icon: "source" },
        { label: "Not a proof system", detail: "declared model only", icon: "shieldBan" }
      ]
    },
    note: {
      text: "Shape checks architecture claims • not arbitrary application correctness",
      icon: "documentCheck"
    },
    reviewTerms: [
      "Inside Shape",
      "Draft claims",
      "Review claims",
      "Check coherence",
      "Tests remain",
      "Not a proof system"
    ]
  },
  {
    name: "shape-workflow",
    layout: "sequence",
    title: "Architecture review in CI",
    summary: "A code change updates reviewed Shape claims before deterministic checking and CI.",
    sources: ["README.md"],
    steps: [
      { id: "diff", label: "Code change", detail: "architecture diff", icon: "branch" },
      { id: "draft", label: "Shape update", detail: "reviewed claims", icon: "fileEdit" },
      { id: "review", label: "Human review", detail: "evidence + unknowns", icon: "userCheck" },
      { id: "check", label: "Check", detail: "shp check", icon: "terminal" },
      { id: "ci", label: "CI gate", detail: "pass or reject", icon: "shield", tone: "green" }
    ],
    note: { text: "the model records intent • diagnostics explain rejected claims", icon: "route" },
    reviewTerms: ["Code change", "Shape update", "Human review", "shp check", "CI gate"]
  }
];
