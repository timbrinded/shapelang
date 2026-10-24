// D3 comparison: how much of a TypeScript function's purity do types decide?
// Runs the TypeScript compiler API over Shape's own source (non-test .ts files
// of packages/shp-checker/src and packages/shp-cli/src) and classifies every
// function-like declaration with a body:
//   types:   TypeScript has no effect types, so no signature excludes I/O,
//            throws or global mutation: "decided pure by types" is 0 by design.
//   E7-style signature bound: every parameter is a primitive, a literal, a
//            readonly array/tuple, or Readonly<...>, and the return type is not
//            void/undefined/never/Promise. This bounds argument mutation only.
//   local syntax: the body (nested functions included) contains a throw, an
//            await, a host global (console, process, Bun, fetch, Date, Math.random,
//            require, globalThis), a write to a property or element, a mutating
//            method call (push, pop, shift, unshift, splice, sort, reverse, fill,
//            set, delete, add, clear), or a call into node:fs / node:child_process.
//   calls:   the body calls something other than a parameter, a built-in
//            method, or a nested function: its purity then depends on callees.
//
//   bun d3/ts_purity.ts <repo-root>

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.argv[2];
const TS = path.join(ROOT, "node_modules/.bun/typescript@6.0.3/node_modules/typescript/lib/typescript.js");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ts: any = (await import(TS)).default;

function walk(d: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}
const files = [...walk(path.join(ROOT, "packages/shp-checker/src")), ...walk(path.join(ROOT, "packages/shp-cli/src"))]
  .filter((f) => !f.includes("__snapshots__") && !f.includes("/generated/"));
const program = ts.createProgram(files, { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, strict: true,
  moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, noEmit: true, skipLibCheck: true });
const checker = program.getTypeChecker();

const HOST = new Set(["console", "process", "Bun", "fetch", "require", "globalThis", "Deno"]);
const MUT = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "set", "delete", "add", "clear", "copyWithin"]);

function primitiveOrReadonly(t: any, depth = 0): boolean {
  if (depth > 3) return false;
  const F = ts.TypeFlags;
  if (t.flags & (F.String | F.Number | F.Boolean | F.BigInt | F.StringLiteral | F.NumberLiteral | F.BooleanLiteral
    | F.BigIntLiteral | F.Undefined | F.Null | F.EnumLiteral | F.Enum | F.Void | F.TemplateLiteral)) return true;
  if (t.isUnion && t.isUnion()) return t.types.every((u: any) => primitiveOrReadonly(u, depth + 1));
  const s = checker.typeToString(t);
  if (/^readonly /.test(s) || /^Readonly(Array|Map|Set)?</.test(s)) return true;
  return false;
}

type Row = { file: string; name: string; sigBound: boolean; local: string[]; calls: boolean; params: number };
const rows: Row[] = [];
const importsFsLike = new Map<string, Set<string>>(); // file -> local names bound to fs/child_process

for (const sf of program.getSourceFiles()) {
  if (!files.includes(sf.fileName)) continue;
  const fsNames = new Set<string>();
  sf.statements.forEach((st: any) => {
    if (ts.isImportDeclaration(st) && /^(node:)?(fs|child_process|fs\/promises)$/.test(st.moduleSpecifier.text)) {
      const c = st.importClause;
      if (c?.name) fsNames.add(c.name.text);
      if (c?.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings)) fsNames.add(c.namedBindings.name.text);
        else c.namedBindings.elements.forEach((e: any) => fsNames.add(e.name.text));
      }
    }
  });
  importsFsLike.set(sf.fileName, fsNames);
  const visit = (n: any) => {
    const isFn = ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n)
      || ts.isConstructorDeclaration(n)
      || ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && (ts.isVariableDeclaration(n.parent) || ts.isPropertyAssignment(n.parent) || ts.isPropertyDeclaration(n.parent)));
    if (isFn && n.body) {
      const name = n.name?.getText?.(sf) ?? n.parent?.name?.getText?.(sf) ?? "(anon)";
      const sig = checker.getSignatureFromDeclaration(n);
      let sigBound = false;
      if (sig) {
        const ret = checker.getReturnTypeOfSignature(sig);
        const rs = checker.typeToString(ret);
        const retOk = !/^(void|undefined|never)$/.test(rs) && !/^Promise</.test(rs) && !ts.isConstructorDeclaration(n) && !ts.isSetAccessor(n);
        const paramsOk = sig.getParameters().every((p: any) => primitiveOrReadonly(checker.getTypeOfSymbolAtLocation(p, n)));
        sigBound = retOk && paramsOk && !ts.isMethodDeclaration(n) && !ts.isGetAccessor(n); // a method also sees `this`
      }
      const params = new Set<string>((n.parameters ?? []).map((p: any) => p.name.getText(sf)));
      const local = new Set<string>();
      let calls = false;
      const inner = (m: any) => {
        if (ts.isThrowStatement(m)) local.add("throw");
        if (ts.isAwaitExpression(m)) local.add("await");
        if (ts.isIdentifier(m) && HOST.has(m.text) && !ts.isPropertyAccessExpression(m.parent)) local.add("host:" + m.text);
        if (ts.isPropertyAccessExpression(m) && m.expression.getText(sf) === "Math" && m.name.text === "random") local.add("host:Math.random");
        if (ts.isIdentifier(m) && m.text === "Date" && !ts.isPropertyAccessExpression(m.parent?.parent ?? {})) local.add("host:Date");
        if (ts.isIdentifier(m) && fsNames.has(m.text)) local.add("host:fs");
        if (ts.isBinaryExpression(m) && m.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && m.operatorToken.kind <= ts.SyntaxKind.LastAssignment
          && (ts.isPropertyAccessExpression(m.left) || ts.isElementAccessExpression(m.left))) local.add("write");
        if ((ts.isPrefixUnaryExpression(m) || ts.isPostfixUnaryExpression(m)) && (m.operator === ts.SyntaxKind.PlusPlusToken || m.operator === ts.SyntaxKind.MinusMinusToken)
          && (ts.isPropertyAccessExpression(m.operand) || ts.isElementAccessExpression(m.operand))) local.add("write");
        if (ts.isCallExpression(m)) {
          const callee = m.expression;
          if (ts.isPropertyAccessExpression(callee) && MUT.has(callee.name.text)) local.add("mutating-call");
          if (ts.isIdentifier(callee) && !params.has(callee.text)) calls = true;
          if (ts.isPropertyAccessExpression(callee)) {
            const sym = checker.getSymbolAtLocation(callee.name);
            const decl = sym?.declarations?.[0];
            const fromLib = decl && /node_modules|lib\..*\.d\.ts|typescript\/lib/.test(decl.getSourceFile().fileName);
            if (!fromLib) calls = true;
          }
        }
        ts.forEachChild(m, inner);
      };
      ts.forEachChild(n.body, inner);
      rows.push({ file: path.relative(ROOT, sf.fileName), name, sigBound, local: [...local].sort(), calls, params: params.size });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

const N = rows.length;
const pct = (k: number, n = N) => `${k} (${(100 * k / n).toFixed(1)}%)`;
const sig = rows.filter((r) => r.sigBound);
const noLocal = rows.filter((r) => r.local.length === 0);
const leaf = noLocal.filter((r) => !r.calls);
const reasons = new Map<string, number>();
for (const r of rows) for (const l of r.local) reasons.set(l.startsWith("host:") ? "host global or fs" : l, (reasons.get(l.startsWith("host:") ? "host global or fs" : l) ?? 0) + 1);
console.log(JSON.stringify({
  files: files.length,
  functions: N,
  decidedPureByTypes: 0,
  signatureBound_E7: pct(sig.length),
  signatureBoundButLocalEffect: pct(sig.filter((r) => r.local.length > 0).length, sig.length) + " of signature-bound",
  noLocalEffectSyntax: pct(noLocal.length),
  noLocalEffectAndNoCalls: pct(leaf.length),
  noLocalEffectButCalls: pct(noLocal.length - leaf.length),
  localEffectReasons: Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1])),
}, null, 1));
