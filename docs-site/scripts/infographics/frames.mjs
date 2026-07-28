/**
 * Generate the production HTML frames used for Shape documentation images.
 *
 * Each concept supplies only semantic content. Layout, type, spacing, icons,
 * connectors, and validation hooks come from the shared template system.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { glyph, icon } from "./icons.js";

await import("./generate-icons.mjs");

const here = dirname(fileURLToPath(import.meta.url));
const framesDir = join(here, "frames");
mkdirSync(framesDir, { recursive: true });

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function tokenHtml(value) {
  return escapeHtml(value).replace("&lt;", "<wbr />&lt;");
}

function markerDefinitions(id) {
  return `
    <defs>
      <marker id="${id}-blue" markerWidth="18" markerHeight="18" refX="16" refY="9"
        orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0 0L18 9L0 18Z" fill="#42aee4" />
      </marker>
      <marker id="${id}-green" markerWidth="18" markerHeight="18" refX="16" refY="9"
        orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0 0L18 9L0 18Z" fill="#19a66a" />
      </marker>
      <marker id="${id}-amber" markerWidth="18" markerHeight="18" refX="16" refY="9"
        orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0 0L18 9L0 18Z" fill="#d28b00" />
      </marker>
      <marker id="${id}-red" markerWidth="18" markerHeight="18" refX="16" refY="9"
        orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0 0L18 9L0 18Z" fill="#d13b3b" />
      </marker>
    </defs>`;
}

function edge(id, from, to, options = {}) {
  const tone = options.tone ?? "blue";
  const classes = ["connector", tone === "blue" ? "" : tone, options.strong ? "strong" : ""]
    .filter(Boolean)
    .join(" ");
  return `<path class="${classes}" data-edge data-from="${from}" data-to="${to}"
    data-route="${options.route ?? "straight"}"
    data-target-gap="${options.targetGap ?? 9}"
    ${options.tension ? `data-tension="${options.tension}"` : ""}
    ${options.allowObstruction ? "data-allow-obstruction" : ""}
    ${options.directed === false ? "" : `marker-end="url(#${id}-${tone})"`} />`;
}

function connectorLayer(id, edges, decoration = "") {
  return `<svg class="connectors" aria-hidden="true">
    ${markerDefinitions(id)}
    ${decoration}
    ${edges.join("\n")}
  </svg>`;
}

function nodeCard(item, options = {}) {
  const detailClass = item.plain ? "node-token plain" : "node-token";
  const attrs = [
    `data-node="${item.id}"`,
    "data-box",
    options.alignRow ? `data-align-row="${options.alignRow}"` : "",
    options.alignColumn ? `data-align-column="${options.alignColumn}"` : "",
    options.equalSize ? `data-equal-size="${options.equalSize}"` : "",
    options.style ? `style="${options.style}"` : ""
  ]
    .filter(Boolean)
    .join(" ");
  return `<article class="node ${item.tone ?? ""} ${options.className ?? ""}" ${attrs}>
    ${icon(item.icon ?? "documentCheck", item.tone ?? "")}
    <div class="node-content">
      <strong class="node-label" data-fit>${escapeHtml(item.label)}</strong>
      ${item.detail ? `<span class="${detailClass}" data-fit>${tokenHtml(item.detail)}</span>` : ""}
    </div>
  </article>`;
}

function noteHtml(note, edgeLabel = "") {
  if (!note) return "";
  return `<div class="note ${note.tone ?? ""}" data-box data-fit
    ${edgeLabel ? `data-edge-label="${edgeLabel}"` : ""}>
    ${glyph(note.icon ?? "flow")}
    <span>${escapeHtml(note.text)}</span>
  </div>`;
}

function shell(concept, body, layout) {
  const title = concept.titleHtml ?? escapeHtml(concept.title);
  return `<!doctype html>
<html lang="en" data-diagram-theme="site-dark" data-diagram-status="pending">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=1680, initial-scale=1" />
    <title>${escapeHtml(concept.title)}</title>
    <link rel="stylesheet" href="../base.css" />
    <link rel="stylesheet" href="../icons.css" />
    <script src="../diagram-runtime.js" defer></script>
  </head>
  <body>
    <main class="canvas">
      ${layout === "hero" ? "" : `<h1 class="diagram-title" data-fit>${title}</h1>`}
      <section class="diagram layout-${layout}"
        aria-label="${escapeHtml(concept.summary)}"
        data-concept="${escapeHtml(concept.name)}"
        data-source="${escapeHtml(concept.sources.join(","))}">
        ${body}
      </section>
    </main>
  </body>
</html>`;
}

function renderSequence(concept) {
  const edges = concept.steps.slice(0, -1).map((step, index) =>
    edge(concept.name, `${step.id}:right`, `${concept.steps[index + 1].id}:left`, {
      tone: concept.steps[index + 1].tone ?? "blue"
    })
  );

  let loopLabel = "";
  if (concept.loopTo) {
    const last = concept.steps.at(-1);
    edges.push(
      edge(concept.name, `${last.id}:bottom`, `${concept.loopTo}:bottom`, {
        route: "curve",
        tension: 0.34,
        tone: concept.loopTone ?? "red"
      })
    );
    loopLabel = `${last.id}:bottom->${concept.loopTo}:bottom`;
  }

  const nodes = concept.steps
    .map((step) =>
      nodeCard(step, {
        alignRow: concept.name,
        equalSize: concept.name
      })
    )
    .join("\n");

  return shell(
    concept,
    `${connectorLayer(concept.name, edges)}
     ${nodes}
     ${noteHtml(concept.note, loopLabel)}`,
    "sequence"
  ).replace(
    `class="diagram layout-sequence"`,
    `class="diagram layout-sequence" style="--count:${concept.steps.length}"`
  );
}

const hubPorts = {
  north: ["top", "bottom"],
  west: ["left", "right"],
  east: ["right", "left"],
  "south-west": ["bottom", "right"],
  "south-east": ["bottom", "left"]
};

function renderHub(concept) {
  const edges = concept.satellites.map((satellite) => {
    const [fromPort, toPort] = hubPorts[satellite.slot];
    return edge(concept.name, `${concept.center.id}:${fromPort}`, `${satellite.id}:${toPort}`, {
      directed: false,
      route: "curve",
      tone: satellite.tone ?? "blue"
    });
  });
  const satellites = concept.satellites
    .map((satellite) =>
      nodeCard(satellite, {
        className: `slot-${satellite.slot}`,
        equalSize: `${concept.name}-satellites`
      })
    )
    .join("\n");

  return shell(
    concept,
    `${connectorLayer(concept.name, edges)}
     ${nodeCard(concept.center, { className: "hub-center" })}
     ${satellites}
     ${noteHtml(concept.note)}`,
    "hub"
  );
}

function renderDecision(concept) {
  const targetPorts = concept.inputs.length === 3 ? ["top", "left", "bottom"] : ["top", "bottom"];
  const edges = concept.inputs.map((input, index) =>
    edge(concept.name, `${input.id}:right`, `${concept.decision.id}:${targetPorts[index]}`, {
      route: "curve",
      tone: input.tone ?? "blue"
    })
  );
  edges.push(
    edge(concept.name, `${concept.decision.id}:right`, `${concept.output.id}:left`, {
      tone: concept.output.tone ?? "blue",
      strong: concept.output.tone === "red"
    })
  );

  const inputs = concept.inputs
    .map((input, index) =>
      nodeCard(input, {
        alignRow: concept.inputs.length === 3 && index === 1 ? `${concept.name}-center` : "",
        equalSize: `${concept.name}-inputs`
      })
    )
    .join("\n");

  const decision = `<div class="decision-core" data-node="${concept.decision.id}" data-box
    data-align-row="${concept.name}-center">
    <div>
      ${glyph(concept.decision.icon ?? "balance")}
      <strong class="node-label" data-fit>${escapeHtml(concept.decision.label)}</strong>
      ${concept.decision.detail ? `<span class="node-token" data-fit>${tokenHtml(concept.decision.detail)}</span>` : ""}
    </div>
  </div>`;

  return shell(
    concept,
    `${connectorLayer(concept.name, edges)}
     <div class="decision-inputs">${inputs}</div>
     ${decision}
     ${nodeCard(concept.output, {
       alignRow: `${concept.name}-center`,
       className: "decision-output"
     })}
     ${noteHtml(concept.note)}`,
    "decision"
  );
}

function renderLanes(concept) {
  const edges = [];
  const nodes = [];
  concept.lanes.forEach((lane, rowIndex) => {
    lane.forEach((item, columnIndex) => {
      nodes.push(
        nodeCard(item, {
          equalSize: `${concept.name}-lanes`,
          style: `grid-column:${columnIndex + 1};grid-row:${rowIndex + 1}`
        })
      );
      if (columnIndex < lane.length - 1) {
        edges.push(
          edge(concept.name, `${item.id}:right`, `${lane[columnIndex + 1].id}:left`, {
            tone: lane[columnIndex + 1].tone ?? "blue"
          })
        );
      }
    });
    edges.push(
      edge(concept.name, `${lane.at(-1).id}:right`, `${concept.output.id}:left`, {
        route: "curve",
        tone: concept.output.tone ?? "blue"
      })
    );
  });

  return shell(
    concept,
    `${connectorLayer(concept.name, edges)}
     ${nodes.join("\n")}
     ${nodeCard(concept.output, { className: "lane-output" })}
     ${noteHtml(concept.note)}`,
    "lanes"
  );
}

function renderSplit(concept) {
  const group = (side, className = "") => `<section class="split-group ${className}" data-box>
    <h2 class="split-title" data-fit>${glyph(side.icon)}${escapeHtml(side.title)}</h2>
    <div class="split-items" style="--columns:${side.items.length}">
      ${side.items
        .map(
          (item) => `<article class="split-item">
            ${glyph(item.icon)}
            <strong data-fit>${escapeHtml(item.label)}</strong>
            <span data-fit>${tokenHtml(item.detail)}</span>
          </article>`
        )
        .join("\n")}
    </div>
  </section>`;

  return shell(
    concept,
    `${connectorLayer(concept.name, [])}
     ${group(concept.inside)}
     ${group(concept.outside, "outside")}
     ${noteHtml(concept.note)}`,
    "split"
  );
}

function renderBoundary(concept) {
  const relation = `${concept.component.id}:right->${concept.external.id}:left`;
  const boundary = `<section class="boundary-box" data-node="${concept.component.id}" data-box>
    <h2 class="boundary-title" data-fit>
      ${glyph(concept.component.icon)}
      ${escapeHtml(concept.component.label)}
    </h2>
    <div class="boundary-items">
      ${concept.component.items
        .map(
          (item) => `<article class="boundary-item">
            <strong data-fit>${escapeHtml(item.label)}</strong>
            <span data-fit>${tokenHtml(item.detail)}</span>
          </article>`
        )
        .join("\n")}
    </div>
  </section>`;

  return shell(
    concept,
    `${connectorLayer(concept.name, [
      edge(concept.name, `${concept.component.id}:right`, `${concept.external.id}:left`)
    ])}
     ${boundary}
     ${nodeCard(concept.external, { className: "boundary-external" })}
     <span class="edge-label" data-box data-fit data-edge-label="${relation}">
       ${escapeHtml(concept.relationLabel)}
     </span>
     ${noteHtml(concept.note)}`,
    "boundary"
  );
}

function renderCycle(concept) {
  const edges = [
    edge(concept.name, `${concept.left.id}:right`, `${concept.right.id}:left`, {
      route: "curve"
    }),
    edge(concept.name, `${concept.right.id}:top`, `${concept.left.id}:top`, {
      route: "curve",
      tone: "amber",
      tension: 0.12
    }),
    edge(concept.name, `${concept.left.id}:bottom`, `${concept.rule.id}:top`),
    edge(concept.name, `${concept.rule.id}:right`, `${concept.result.id}:left`, {
      tone: "red",
      strong: true
    })
  ];
  const calls = `${concept.left.id}:right->${concept.right.id}:left`;
  const callbacks = `${concept.right.id}:top->${concept.left.id}:top`;

  return shell(
    concept,
    `${connectorLayer(concept.name, edges)}
     ${nodeCard(concept.left, {
       alignRow: `${concept.name}-top`,
       className: "cycle-node-a",
       equalSize: `${concept.name}-top`
     })}
     ${nodeCard(concept.right, {
       alignRow: `${concept.name}-top`,
       className: "cycle-node-b",
       equalSize: `${concept.name}-top`
     })}
     ${nodeCard(concept.rule, {
       alignRow: `${concept.name}-bottom`,
       className: "cycle-rule",
       equalSize: `${concept.name}-bottom`
     })}
     ${nodeCard(concept.result, {
       alignRow: `${concept.name}-bottom`,
       className: "cycle-result",
       equalSize: `${concept.name}-bottom`
     })}
     <span class="edge-label calls" data-box data-fit data-edge-label="${calls}">calls</span>
     <span class="edge-label callbacks" data-box data-fit data-edge-label="${callbacks}">callbacks</span>
     ${noteHtml(concept.note)}`,
    "cycle"
  );
}

const concepts = [
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

const renderers = {
  boundary: renderBoundary,
  cycle: renderCycle,
  decision: renderDecision,
  hub: renderHub,
  lanes: renderLanes,
  sequence: renderSequence,
  split: renderSplit
};

for (const concept of concepts) {
  const renderer = renderers[concept.layout];
  if (!renderer) throw new Error(`Unknown infographic layout: ${concept.layout}`);
  const html = renderer(concept).replace(/[ \t]+$/gm, "");
  writeFileSync(join(framesDir, `${concept.name}.html`), html, "utf8");
  console.log(`wrote ${concept.name}.html`);
}

writeFileSync(
  join(here, "manifest.json"),
  `${JSON.stringify(
    concepts.map(({ name, title, layout, summary, sources, reviewTerms }) => ({
      layout,
      name,
      reviewTerms,
      sources,
      summary,
      title
    })),
    null,
    2
  )}\n`,
  "utf8"
);
