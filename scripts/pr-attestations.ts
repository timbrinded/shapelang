import {
  parseAttestationBundle,
  type ShapeAttestationBundleV1
} from "../packages/shp-checker/src/attestations.ts";

const start = "<!-- shapelang:attestations:v1 -->";
const end = "<!-- /shapelang:attestations -->";
function section(body: string): { start: number; end: number; contents: string } | undefined {
  const markers = body.match(/<!--\s*\/?shapelang:attestations\b[^>]*-->/g) ?? [];
  const starts = body.match(/<!--\s*\/?shapelang:attestations\b/g) ?? [];
  if (starts.length !== markers.length) throw new Error("Unclosed ShapeLang attestation marker.");
  if (markers.length === 0) return undefined;
  if (markers.length !== 2 || markers[0] !== start || markers[1] !== end) {
    throw new Error("Malformed, duplicate, or unsupported ShapeLang attestation markers.");
  }
  const from = body.indexOf(start);
  const to = body.indexOf(end, from + start.length);
  if (to < 0) throw new Error("Unclosed ShapeLang attestation block.");
  return { start: from, end: to + end.length, contents: body.slice(from + start.length, to) };
}
export function extractAttestations(body: string): ShapeAttestationBundleV1 | undefined {
  const block = section(body);
  if (!block) return undefined;
  const fences = [...block.contents.matchAll(/^```(json|yaml)\s*\r?\n([\s\S]*?)^```\s*$/gm)];
  if (fences.length !== 1 || !fences[0])
    throw new Error("Expected exactly one JSON or YAML payload in the attestation block.");
  const match = fences[0];
  const text = match[2] ?? "";
  return parseAttestationBundle(match[1] === "json" ? JSON.parse(text) : Bun.YAML.parse(text));
}
export function replaceAttestations(body: string, evidence: unknown): string {
  const bundle = parseAttestationBundle(evidence);
  const block = section(body);
  const replacement = `${start}\n<details>\n<summary>ShapeLang attestations</summary>\n\n\`\`\`json\n${JSON.stringify(bundle, null, 2).replaceAll("<", "\\u003c")}\n\`\`\`\n\n</details>\n${end}`;
  return block
    ? body.slice(0, block.start) + replacement + body.slice(block.end)
    : body + (body.endsWith("\n") ? "\n" : "\n\n") + replacement + "\n";
}
if (import.meta.main) {
  const [action, input, output, evidence] = process.argv.slice(2);
  if (!input || !output || !["extract", "replace"].includes(action ?? ""))
    throw new Error(
      "Usage: bun scripts/pr-attestations.ts extract|replace body.md output [bundle.json]"
    );
  const body = await Bun.file(input).text();
  if (action === "replace") {
    if (!evidence) throw new Error("replace requires bundle.json");
    await Bun.write(output, replaceAttestations(body, await Bun.file(evidence).json()));
  } else {
    const bundle = extractAttestations(body);
    // Absence is represented by null, never invented evidence for a transition.
    await Bun.write(output, JSON.stringify(bundle ?? null, null, 2) + "\n");
  }
}
