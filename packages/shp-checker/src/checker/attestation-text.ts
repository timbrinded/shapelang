// Source-text view of a module's top-level attestations. Bindings compare a
// .shape file's text without attestations against its base version, and
// `shp attest prune` deletes stale attestations, so both use one definition of
// which bytes an attestation occupies.
import { isAttestationDecl, type ShapeModule } from "../language/generated/ast.ts";
import { attestationIdentity } from "./lowering/declarations.ts";
import { attestationKey } from "./rules/coverage.ts";

export type AttestationRemoval = { text: string; removed: number };

/**
 * Returns the module's source with each top-level attestation whose key passes
 * `shouldRemove` deleted, together with the whitespace after it. Every other
 * byte is kept. Attestations inside `change` blocks are left in place.
 */
export function removeAttestations(
  module: ShapeModule,
  shouldRemove: (key: string) => boolean
): AttestationRemoval {
  const source = module.$cstNode?.root.fullText ?? "";
  const ranges = module.declarations
    .filter(isAttestationDecl)
    .filter((declaration) => shouldRemove(attestationKey(attestationIdentity(declaration))))
    .flatMap((declaration) =>
      declaration.$cstNode
        ? [{ start: declaration.$cstNode.offset, end: declaration.$cstNode.end }]
        : []
    )
    .toSorted((left, right) => right.start - left.start);

  let text = source;
  for (const range of ranges) {
    let end = range.end;
    while (end < text.length && /\s/.test(text.charAt(end))) {
      end += 1;
    }
    text = text.slice(0, range.start) + text.slice(end);
  }
  return { text: ranges.length > 0 ? `${text.trimEnd()}\n` : text, removed: ranges.length };
}
