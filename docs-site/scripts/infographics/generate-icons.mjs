import {
  AlertCircleIcon,
  ArtificialIntelligence04Icon,
  Audit01Icon,
  BalanceScaleIcon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  CodeIcon,
  ComputerTerminal01Icon,
  Database01Icon,
  DocumentValidationIcon,
  FileCodeIcon,
  FileEditIcon,
  FlowConnectionIcon,
  GitBranchIcon,
  GitCompareArrowsIcon,
  HierarchyIcon,
  Layers01Icon,
  Link01Icon,
  Route01Icon,
  Search01Icon,
  Shield01Icon,
  ShieldBanIcon,
  SourceCodeIcon,
  UserCheck02Icon
} from "@hugeicons/core-free-icons";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const icons = {
  agent: ArtificialIntelligence04Icon,
  alert: AlertCircleIcon,
  audit: Audit01Icon,
  balance: BalanceScaleIcon,
  cancel: CancelCircleIcon,
  check: CheckmarkCircle02Icon,
  clock: Clock01Icon,
  code: CodeIcon,
  database: Database01Icon,
  documentCheck: DocumentValidationIcon,
  fileCode: FileCodeIcon,
  fileEdit: FileEditIcon,
  flow: FlowConnectionIcon,
  hierarchy: HierarchyIcon,
  layers: Layers01Icon,
  link: Link01Icon,
  route: Route01Icon,
  search: Search01Icon,
  shield: Shield01Icon,
  shieldBan: ShieldBanIcon,
  source: SourceCodeIcon,
  terminal: ComputerTerminal01Icon,
  userCheck: UserCheck02Icon,
  branch: GitBranchIcon,
  compare: GitCompareArrowsIcon
};

const attributeNames = {
  clipRule: "clip-rule",
  fillRule: "fill-rule",
  strokeDasharray: "stroke-dasharray",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  strokeMiterlimit: "stroke-miterlimit",
  strokeWidth: "stroke-width"
};

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderAttributes(attributes) {
  return Object.entries(attributes)
    .filter(([name]) => name !== "key")
    .map(([name, value]) => `${attributeNames[name] ?? name}="${escapeAttribute(value)}"`)
    .join(" ");
}

function renderMask(nodes) {
  const body = nodes
    .map(([element, attributes]) => {
      const maskAttributes = Object.fromEntries(
        Object.entries(attributes).map(([name, value]) => [
          name,
          value === "currentColor" ? "#000000" : value
        ])
      );
      return `<${element} ${renderAttributes(maskAttributes)} />`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${body}</svg>`;
  return `url("${`data:image/svg+xml,${encodeURIComponent(svg)}`}")`;
}

const iconCss = Object.entries(icons)
  .map(([name, nodes]) => `.hi-${name}{--hi-mask:${renderMask(nodes)}}`)
  .join("\n");

writeFileSync(join(here, "icons.css"), `${iconCss}\n`, "utf8");
