// Example law file for the laws provider: property tests bound to three schema laws on Shape's own
// string helpers (packages/shp-checker/src/shape-strings.ts), declared in strings.source.json.
//   bun experiments/shape-1/proto/providers/cli.ts laws run --root . \
//     --source experiments/shape-1/proto/providers/examples/strings.source.json \
//     --law experiments/shape-1/proto/providers/examples/strings.law.ts \
//     --provider strings::bunLaws --decides "template CodepointOrder" --mutants 40
import { compareCodepointStrings, normalizeShapeSourcePath, unquoteShapeString } from "../../../../../packages/shp-checker/src/shape-strings.ts";
import { gen, law } from "../laws/pbt.ts";

const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);
const codepoints = (s: string): number[] => Array.from(s, (c) => c.codePointAt(0) ?? 0);
function oracle(a: string, b: string): number {
  const x = codepoints(a);
  const y = codepoints(b);
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return x.length - y.length;
}
const text = gen.string("abé\u{1F600}", 6);
const ORDER = "strings::ShapeStringHelpers.compareCodepointStrings/CodepointOrder/law";
law(ORDER, gen.tuple(text, text), ([a, b]) => sign(compareCodepointStrings(a, b)) === sign(oracle(a, b)), { runs: 500, seed: 11, domain: "strings over {a, b, é, U+1F600} of length ≤ 6" });
law(ORDER, gen.tuple(text, text), ([a, b]) => sign(compareCodepointStrings(a, b)) === -sign(compareCodepointStrings(b, a)), { runs: 300, seed: 12, name: "antisymmetric" });

const quotedEdge = (s: string): boolean => s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"));
law(
  "strings::ShapeStringHelpers.unquoteShapeString/Unquotes/law",
  gen.string("ab'\" ", 6),
  (s) => unquoteShapeString(`"${s}"`) === s && unquoteShapeString(`'${s}'`) === s && (s.length === 1 || quotedEdge(s) || unquoteShapeString(s) === s),
  { runs: 400, seed: 13, domain: "strings over {a, b, ', \", space} of length ≤ 6; length-1 values excluded" }
);

const pathText = gen.string("ab/\\.", 6);
law(
  "strings::ShapeStringHelpers.normalizeShapeSourcePath/PathNormal/law",
  gen.tuple(pathText, gen.int(0, 999), gen.int(0, 999)),
  ([p, n, m]) => {
    const base = normalizeShapeSourcePath(p);
    return normalizeShapeSourcePath(`${p}:${n}`) === base && normalizeShapeSourcePath(`${p}:${n}-${m}`) === base && normalizeShapeSourcePath(`${p}#sym`) === base && !base.includes("\\");
  },
  { runs: 400, seed: 14, domain: "paths over {a, b, /, \\, .} of length ≤ 6 with :line, :a-b and #anchor suffixes" }
);
