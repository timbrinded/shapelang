const canvas = document.getElementById("scene");
const context = canvas.getContext("2d", { alpha: false });
if (!context) {
  const failure = document.createElement("p");
  failure.textContent =
    "This browser cannot create the canvas view. Use the authored Shape model index instead.";
  canvas.replaceWith(failure);
  throw new Error("Canvas 2D is unavailable");
}
const locator = document.getElementById("locator");
const results = document.getElementById("results");
const overviewButton = document.getElementById("overview");
const motionButton = document.getElementById("motion");
const selectionKind = document.getElementById("selection-kind");
const selectionTitle = document.getElementById("selection-title");
const selectionSummary = document.getElementById("selection-summary");
const details = document.getElementById("details");
const navigatorPanel = document.getElementById("controls");
const relationshipCount = document.getElementById("relationship-count");
const relationshipList = document.getElementById("relationship-list");
const evidenceCount = document.getElementById("evidence-count");
const evidenceList = document.getElementById("evidence-list");
const hoverLabel = document.getElementById("hover-label");
const hoverLabelSwatch = document.getElementById("hover-label-swatch");
const hoverLabelKind = document.getElementById("hover-label-kind");
const hoverLabelName = document.getElementById("hover-label-name");
const flightStatus = document.getElementById("flight-status");
const modelIndexList = document.getElementById("model-index-list");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const styles = {
  module: {
    top: "#17546f",
    front: "#0b3145",
    side: "#103c52",
    width: 11,
    depth: 10,
    height: 8
  },
  component: {
    top: "#ff5a1f",
    front: "#c63a11",
    side: "#df4814",
    width: 12.2,
    depth: 10.4,
    height: 8.5
  },
  resource: {
    top: "#eaff9b",
    front: "#b9c86b",
    side: "#d0df7b",
    width: 10,
    depth: 8.5,
    height: 5.1
  },
  function: {
    top: "#f4ffd0",
    front: "#c7d58c",
    side: "#ddeca8",
    width: 8.2,
    depth: 7.1,
    height: 3.7
  },
  relation: {
    top: "#d95ce9",
    front: "#9d3aae",
    side: "#bb45c7",
    width: 9.1,
    depth: 7.7,
    height: 6.2
  },
  implementation: {
    top: "#28566e",
    front: "#133745",
    side: "#1d4a5d",
    width: 10.1,
    depth: 8.3,
    height: 5.8
  },
  binding: {
    top: "#35b9ee",
    front: "#14749c",
    side: "#258fbf",
    width: 9.3,
    depth: 7.9,
    height: 5.5
  },
  rule: {
    top: "#85ea49",
    front: "#4aa72b",
    side: "#68c639",
    width: 9.3,
    depth: 7.9,
    height: 5.5
  }
};
const typeNames = {
  module: "module",
  component: "component",
  resource: "resource",
  function: "function",
  relation: "relation",
  implementation: "implementation",
  binding: "binding",
  rule: "rule"
};

const atlas = __ATLAS_MODEL_JSON__;
const nodes = atlas.nodes;
const nodeById = new Map(nodes.map((node) => [node.id, node]));
const nodeByModelId = new Map(
  nodes.filter((node) => node.modelId).map((node) => [node.modelId, node])
);
const districts = atlas.districts.map((district) => ({
  ...district,
  node: nodeById.get(district.nodeId),
  entities: district.entityIds.map((id) => nodeById.get(id))
}));
const edges = atlas.edges;
const neighbours = new Map(nodes.map((node) => [node.id, new Set()]));

edges.forEach((edge) => {
  neighbours.get(edge.from).add(edge.to);
  neighbours.get(edge.to).add(edge.from);
});

nodes
  .slice()
  .sort(
    (left, right) =>
      compareCodepoints(left.module, right.module) ||
      compareCodepoints(left.type, right.type) ||
      compareCodepoints(left.label, right.label)
  )
  .forEach((node) => {
    const item = document.createElement("li");
    item.textContent = node.module + ": " + node.type + " " + node.label + " in " + node.file;
    modelIndexList.append(item);
  });

function compareCodepoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

nodes
  .slice()
  .sort(
    (left, right) =>
      compareCodepoints(left.module, right.module) ||
      compareCodepoints(left.type, right.type) ||
      compareCodepoints(left.label, right.label)
  )
  .forEach((node) => {
    const item = document.createElement("li");
    item.textContent = node.module + ": " + node.type + " " + node.label + " in " + node.file;
    modelIndexList.append(item);
  });

function childOrder(node) {
  const childNodes = node.childIds
    .map((id) => nodeById.get(id))
    .filter((child) => child && child.module === node.module);
  return [node, ...childNodes];
}

const districtColumns = Math.max(1, Math.ceil(Math.sqrt(districts.length)));
const cellX = 15;
const cellZ = 14;
districts.forEach((district) => {
  const ordered = [];
  const used = new Set();
  const moduleNode = district.node;
  ordered.push(moduleNode);
  used.add(moduleNode.id);
  district.entities
    .filter((node) => node.type === "component")
    .forEach((component) => {
      childOrder(component).forEach((node) => {
        if (!used.has(node.id)) {
          ordered.push(node);
          used.add(node.id);
        }
      });
    });
  district.entities.forEach((node) => {
    if (!used.has(node.id)) {
      ordered.push(node);
      used.add(node.id);
    }
  });

  const columns = Math.max(5, Math.ceil(Math.sqrt(ordered.length * 1.55)));
  const rows = Math.ceil(ordered.length / columns);
  district.gridColumns = columns;
  district.width = columns * cellX + 30;
  district.depth = rows * cellZ + 42;
  district.entities = ordered;
});
const districtSpacingX = Math.max(
  270,
  Math.max(...districts.map((district) => district.width)) + 90
);
const districtSpacingZ = Math.max(
  240,
  Math.max(...districts.map((district) => district.depth)) + 90
);
districts.forEach((district, index) => {
  const xIndex = index % districtColumns;
  const zIndex = Math.floor(index / districtColumns);
  const jitterX = ((index * 43) % 31) - 15;
  const jitterZ = ((index * 29) % 19) - 9;
  district.x = (xIndex - (districtColumns - 1) / 2) * districtSpacingX + jitterX;
  district.z = 80 + zIndex * districtSpacingZ + jitterZ;
  district.entities.forEach((node, nodeIndex) => {
    const column = nodeIndex % district.gridColumns;
    const row = Math.floor(nodeIndex / district.gridColumns);
    node.x = district.x - district.width / 2 + 18 + column * cellX;
    node.z = district.z - district.depth / 2 + 25 + row * cellZ;
    node.district = district;
    node.gridIndex = nodeIndex;
  });
});

const fixedPerspective = {
  yaw: 0,
  pitch: -0.27
};
const layoutBounds = districts.reduce(
  (bounds, district) => ({
    minX: Math.min(bounds.minX, district.x - district.width / 2),
    maxX: Math.max(bounds.maxX, district.x + district.width / 2),
    minZ: Math.min(bounds.minZ, district.z - district.depth / 2),
    maxZ: Math.max(bounds.maxZ, district.z + district.depth / 2)
  }),
  { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
);
const layoutSpanX = layoutBounds.maxX - layoutBounds.minX;
const layoutSpanZ = layoutBounds.maxZ - layoutBounds.minZ;
const overviewHeight = Math.max(84, layoutSpanX * 0.34, layoutSpanZ * 0.28);
const maximumCameraHeight = Math.max(290, overviewHeight * 1.4);
const initialCamera = {
  x: (layoutBounds.minX + layoutBounds.maxX) / 2,
  y: overviewHeight,
  z: layoutBounds.minZ - Math.max(168, overviewHeight * 1.8),
  yaw: fixedPerspective.yaw,
  pitch: fixedPerspective.pitch
};
const state = {
  width: 0,
  height: 0,
  dpr: 1,
  fov: 0.9,
  camera: { ...initialCamera },
  keys: new Set(),
  selectedId: null,
  hoverId: null,
  pointer: null,
  focus: null,
  projected: [],
  lastTime: performance.now(),
  pathGlow: !prefersReducedMotion.matches && nodes.length <= 1500,
  frame: 0,
  rendered: false,
  startedAt: performance.now()
};
let animationFrame = null;

export {
  animationFrame,
  details,
  evidenceCount,
  evidenceList,
  flightStatus,
  hoverLabel,
  hoverLabelKind,
  hoverLabelName,
  hoverLabelSwatch,
  locator,
  maximumCameraHeight,
  motionButton,
  navigatorPanel,
  nodeByModelId,
  overviewButton,
  relationshipCount,
  relationshipList,
  results,
  selectionKind,
  selectionSummary,
  selectionTitle,
  state,
  styles,
  typeNames
};
