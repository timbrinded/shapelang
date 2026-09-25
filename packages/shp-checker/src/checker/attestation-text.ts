// Source-text view of a module's attestations. Bindings compare a .shape file's
// text without attestations against its base version, and `shp attest prune`
// deletes stale attestations, so both use one definition of which bytes an
// attestation occupies.
import {
  isAddDeclarationChange,
  isAttestationDecl,
  isChangeDecl,
  isModifyDeclarationChange,
  type AttestationDecl,
  type ChangeEntry,
  type ShapeModule
} from "../language/generated/ast.ts";
import { attestationIdentity } from "./lowering/declarations.ts";
import { attestationKey } from "./rules/coverage.ts";

export type AttestationRemoval = { text: string; removed: number };

/**
 * The module's source with every attestation removed, or undefined when the
 * module has no source text because it was built in code rather than parsed.
 */
export function attestationFreeText(module: ShapeModule): string | undefined {
  return module.$cstNode === undefined ? undefined : removeAttestations(module, () => true).text;
}

/**
 * Returns the module's source with each attestation whose key passes
 * `shouldRemove` deleted: a top-level `attest`, or an `add` or `modify` entry of
 * a `change` block that declares one. The whitespace between it and the next
 * declaration or entry goes with it. When nothing but a closing brace or the end
 * of the file follows, the whitespace before it goes instead, so the file keeps
 * its ending. Every other byte is kept.
 */
export function removeAttestations(
  module: ShapeModule,
  shouldRemove: (key: string) => boolean
): AttestationRemoval {
  const ranges = attestationNodes(module)
    .filter(({ attestation }) => shouldRemove(attestationKey(attestationIdentity(attestation))))
    .flatMap(({ node }) =>
      node.$cstNode ? [{ start: node.$cstNode.offset, end: node.$cstNode.end }] : []
    )
    .toSorted((left, right) => right.start - left.start);

  let text = module.$cstNode?.root.fullText ?? "";
  for (const range of ranges) {
    let after = range.end;
    while (after < text.length && /\s/.test(text.charAt(after))) {
      after += 1;
    }
    if (after < text.length && text.charAt(after) !== "}") {
      text = text.slice(0, range.start) + text.slice(after);
      continue;
    }
    let before = range.start;
    while (before > 0 && /\s/.test(text.charAt(before - 1))) {
      before -= 1;
    }
    text = text.slice(0, before) + text.slice(range.end);
  }
  return { text, removed: ranges.length };
}

type AttestationNode = { node: AttestationDecl | ChangeEntry; attestation: AttestationDecl };

function attestationNodes(module: ShapeModule): AttestationNode[] {
  return module.declarations.flatMap((declaration): AttestationNode[] => {
    if (isAttestationDecl(declaration)) {
      return [{ node: declaration, attestation: declaration }];
    }
    if (!isChangeDecl(declaration)) {
      return [];
    }
    return declaration.entries.flatMap((entry) =>
      (isAddDeclarationChange(entry) || isModifyDeclarationChange(entry)) &&
      isAttestationDecl(entry.declaration)
        ? [{ node: entry, attestation: entry.declaration }]
        : []
    );
  });
}
