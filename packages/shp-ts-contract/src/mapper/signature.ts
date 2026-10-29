import { SyntaxKind } from "typescript/ast";
import { createScanner } from "typescript/ast/scanner";

/**
 * Keep authored type text inside the generated alias. The caller must embed
 * it in parentheses, here inside a one-element tuple:
 * `type Expected = [(${value})];`. Balanced fragments cannot close that
 * wrapper, and comments cannot suppress the generated checks.
 *
 * This is a lexical boundary, not a type parser. The native compiler checks
 * the remaining grammar and type meaning of the parenthesized expression.
 * V1 also excludes type queries and generated helper names from authored
 * signatures. These restrictions do not establish transitive independence
 * of imported type definitions from the implementation.
 */
export function validateSignatureFragment(value: string): string | undefined {
  const scanner = createScanner(false, undefined, value);
  const delimiters: SyntaxKind[] = [];
  let hasToken = false;

  for (let token = scanner.scan(); token !== SyntaxKind.EndOfFile; token = scanner.scan()) {
    if (token === SyntaxKind.Unknown) {
      return "Signature contains an unrecognized TypeScript token.";
    }
    if (scanner.isUnterminated()) {
      return "Signature contains an unterminated TypeScript token.";
    }
    if (token === SyntaxKind.Identifier && scanner.getTokenValue().startsWith("__Shape")) {
      return "Signature identifiers beginning with __Shape are reserved for generated checks.";
    }

    switch (token) {
      case SyntaxKind.WhitespaceTrivia:
      case SyntaxKind.NewLineTrivia:
        continue;
      case SyntaxKind.SingleLineCommentTrivia:
      case SyntaxKind.MultiLineCommentTrivia:
      case SyntaxKind.ConflictMarkerTrivia:
        return "Signature cannot contain comments, directives, or conflict markers.";
      case SyntaxKind.TypeOfKeyword:
        return "Signature typeof type queries are not supported in authored contracts.";
      case SyntaxKind.TemplateHead:
      case SyntaxKind.TemplateMiddle:
      case SyntaxKind.TemplateTail:
        return "Signature template substitutions are not supported.";
      // Each opening delimiter records the closing token it requires.
      case SyntaxKind.OpenParenToken:
        delimiters.push(SyntaxKind.CloseParenToken);
        break;
      case SyntaxKind.OpenBracketToken:
        delimiters.push(SyntaxKind.CloseBracketToken);
        break;
      case SyntaxKind.OpenBraceToken:
        delimiters.push(SyntaxKind.CloseBraceToken);
        break;
      case SyntaxKind.CloseParenToken:
      case SyntaxKind.CloseBracketToken:
      case SyntaxKind.CloseBraceToken:
        if (delimiters.pop() !== token) {
          return "Signature contains unmatched or incorrectly nested delimiters.";
        }
        break;
      case SyntaxKind.SemicolonToken:
        if (delimiters.length === 0) {
          return "Signature cannot contain a top-level semicolon.";
        }
        break;
    }
    hasToken = true;
  }

  if (!hasToken) {
    return "Signature must contain a TypeScript type expression.";
  }
  if (delimiters.length > 0) {
    return "Signature contains unmatched or incorrectly nested delimiters.";
  }
  return undefined;
}
