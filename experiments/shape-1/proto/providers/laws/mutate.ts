// Source mutants of one code identity (a unit's span), for law teeth (bound.mutants, A.10.5):
// relational, equality, arithmetic and logical operator swaps, boolean flips, numeric literal +1 and
// dropped negations (the standard operators of Bend-C2). Deterministic, ordered by position.
import { type TsFull, type TsNode, lineCol, scriptKindOf } from "../ts-api.ts";

export interface Mutant {
  /** "<op>@<line>:<col>" */
  id: string;
  op: string;
  start: number;
  end: number;
  replacement: string;
}

const SWAPS: Record<string, string> = {
  "<": "<=",
  "<=": "<",
  ">": ">=",
  ">=": ">",
  "===": "!==",
  "!==": "===",
  "==": "!=",
  "!=": "==",
  "+": "-",
  "-": "+",
  "*": "/",
  "/": "*",
  "%": "*",
  "&&": "||",
  "||": "&&",
  "??": "||"
};

const OP_CLASS: Record<string, string> = {
  "<": "relational",
  "<=": "relational",
  ">": "relational",
  ">=": "relational",
  "===": "equality",
  "!==": "equality",
  "==": "equality",
  "!=": "equality",
  "+": "arithmetic",
  "-": "arithmetic",
  "*": "arithmetic",
  "/": "arithmetic",
  "%": "arithmetic",
  "&&": "logical",
  "||": "logical",
  "??": "logical"
};

export function mutantsOf(ts: TsFull, path: string, text: string, span: { start: number; end: number }): Mutant[] {
  const K = ts.SyntaxKind;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest as number, true, scriptKindOf(ts, path));
  const out: Mutant[] = [];
  const add = (op: string, start: number, end: number, replacement: string): void => {
    out.push({ id: `${op}@${lineCol(sf, start)}`, op, start, end, replacement });
  };
  const visit = (n: TsNode): void => {
    if (n.end <= span.start || n.pos >= span.end) return;
    const start = n.getStart(sf);
    if (start >= span.start && n.end <= span.end) {
      if (n.kind === K.BinaryExpression && n.operatorToken) {
        const opText = text.slice(n.operatorToken.getStart(sf), n.operatorToken.end);
        const rep = SWAPS[opText];
        // string concatenation stays: "+" on a string literal operand is not arithmetic
        const strOperand = (x: TsNode | undefined): boolean =>
          !!x && (x.kind === K.StringLiteral || x.kind === K.TemplateExpression || x.kind === K.NoSubstitutionTemplateLiteral);
        if (rep && !(opText === "+" && (strOperand(n.left) || strOperand(n.right)))) {
          add(`${OP_CLASS[opText] ?? "op"}:${opText}→${rep}`, n.operatorToken.getStart(sf), n.operatorToken.end, rep);
        }
      } else if (n.kind === K.TrueKeyword) add("boolean:true→false", start, n.end, "false");
      else if (n.kind === K.FalseKeyword) add("boolean:false→true", start, n.end, "true");
      else if (n.kind === K.NumericLiteral) {
        const raw = text.slice(start, n.end);
        const v = Number(raw.replace(/_/g, ""));
        if (Number.isSafeInteger(v) && n.parent?.kind !== K.EnumMember && n.parent?.kind !== K.LiteralType) add(`constant:${raw}→${v + 1}`, start, n.end, String(v + 1));
      } else if (n.kind === K.PrefixUnaryExpression && n.operator === K.ExclamationToken && n.operand) {
        add("negation:drop", start, n.operand.getStart(sf), "");
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** At most n items, evenly spaced over the list (deterministic). */
export function pickEven<T>(xs: T[], n: number): T[] {
  if (n <= 0) return [];
  if (xs.length <= n) return [...xs];
  const out: T[] = [];
  for (let i = 0; i < n; i += 1) out.push(xs[Math.floor((i * xs.length) / n)] as T);
  return out;
}

export function applyMutant(text: string, m: Mutant): string {
  return text.slice(0, m.start) + m.replacement + text.slice(m.end);
}
