import { glyph, icon } from "./icons.js";

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
    ${options.tension ? `data-tension="${options.tension}"` : ""}
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
  const attrs = [
    `data-node="${item.id}"`,
    "data-box",
    options.alignRow ? `data-align-row="${options.alignRow}"` : "",
    options.equalSize ? `data-equal-size="${options.equalSize}"` : ""
  ]
    .filter(Boolean)
    .join(" ");
  return `<article class="node ${item.tone ?? ""} ${options.className ?? ""}" ${attrs}>
    ${icon(item.icon ?? "documentCheck", item.tone ?? "")}
    <div class="node-content">
      <strong class="node-label" data-fit>${escapeHtml(item.label)}</strong>
      ${item.detail ? `<span class="node-token" data-fit>${tokenHtml(item.detail)}</span>` : ""}
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
    <link rel="stylesheet" href="../../../node_modules/@fontsource-variable/geist/wght.css" />
    <link rel="stylesheet" href="../../../node_modules/@fontsource-variable/geist-mono/wght.css" />
    <link rel="stylesheet" href="../base.css" />
    <link rel="stylesheet" href="../icons.css" />
    <script src="../diagram-runtime.js" defer></script>
  </head>
  <body>
    <main class="canvas">
      <h1 class="diagram-title" data-fit>${title}</h1>
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

const renderers = {
  boundary: renderBoundary,
  cycle: renderCycle,
  decision: renderDecision,
  hub: renderHub,
  sequence: renderSequence,
  split: renderSplit
};

export function renderFrame(concept) {
  const renderer = renderers[concept.layout];
  if (!renderer) throw new Error(`Unknown infographic layout: ${concept.layout}`);
  return renderer(concept).replace(/[ \t]+$/gm, "");
}
