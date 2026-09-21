import { expect, test } from "bun:test";
import { extractAttestations, replaceAttestations } from "./pr-attestations.ts";
const bundle = {
  version: 1 as const,
  base: "a".repeat(40),
  head: "b".repeat(40),
  attestations: []
};
test("round trips and preserves unrelated PR prose byte-for-byte", () => {
  const body = replaceAttestations("Human introduction\n", bundle) + "\nHuman ending\n";
  expect(extractAttestations(body)).toEqual(bundle);
  const changed = replaceAttestations(body, { ...bundle, head: "c".repeat(40) });
  expect(changed).toStartWith("Human introduction\n\n");
  expect(changed).toEndWith("\nHuman ending\n");
  expect(extractAttestations(changed)?.head).toBe("c".repeat(40));
});
test("missing block is absence, malformed and duplicate blocks fail", () => {
  expect(extractAttestations("No evidence")).toBeUndefined();
  const body = replaceAttestations("", bundle);
  for (const bad of [
    body + body,
    body.replace(":v1", ":v2"),
    body.replace("<!-- /shapelang:attestations -->", ""),
    body.replace('"version": 1', '"version": 2')
  ]) {
    expect(() => extractAttestations(bad)).toThrow();
  }
});
test("YAML inside optional details wrapper", () => {
  expect(
    extractAttestations(
      `<!-- shapelang:attestations:v1 -->\n\`\`\`yaml\nversion: 1\nbase: "${bundle.base}"\nhead: "${bundle.head}"\nattestations: []\n\`\`\`\n<!-- /shapelang:attestations -->`
    )
  ).toEqual(bundle);
});

test("rationale marker text cannot inject a second block", () => {
  const evidence = {
    ...bundle,
    attestations: [
      {
        obligation: `shp-obligation-${"a".repeat(64)}`,
        kind: "no-shape-change" as const,
        rationale: "Example <!-- /shapelang:attestations -->"
      }
    ]
  };
  const body = replaceAttestations("Human text", evidence);
  expect(extractAttestations(body)).toEqual(evidence);
});

test("an unclosed marker is malformed, not a missing block", () => {
  expect(() => extractAttestations("<!-- shapelang:attestations:v1")).toThrow("Unclosed");
});
