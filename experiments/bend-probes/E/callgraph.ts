// Shared deterministic TypeScript facts for E3/E5: function-like declarations,
// resolved call edges (via the TypeScript type checker, aliases and namespace
// imports followed; callees reached only through a typed value fall back to
// the value's type symbol), throws, and calls to an I/O name list.
import { createRequire } from "node:module";
import { relative } from "node:path";

const DEPS = process.env.EDEPS ?? "/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/work/E/deps";
export const ts = createRequire(DEPS + "/package.json")("typescript") as typeof import("typescript");

export type CallEdge = { file: string; name: string; awaited: boolean; via: "symbol" | "type" };
export type FnFact = {
  file: string; // relative to root
  name: string; // top-level function name, or Class.method
  node: import("typescript").Node;
  calls: CallEdge[];
  throws: number;
  io: string[];
  importsInFile: number;
};

const IO_RE = /^(fetch|readFile|writeFile|readFileSync|writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|spawn|spawnSync|exec|execSync|execFileSync|console\.\w+|process\.(exit|stdout\.write|stderr\.write)|Bun\.(spawn|spawnSync|write|file)|fs\.\w+|db\.\w+)$/;

function declName(d: import("typescript").Declaration): string | undefined {
  if ((ts.isFunctionDeclaration(d) || ts.isVariableDeclaration(d)) && d.name && ts.isIdentifier(d.name)) return d.name.text;
  if ((ts.isMethodDeclaration(d) || ts.isPropertyDeclaration(d)) && d.name && ts.isIdentifier(d.name)) {
    const cls = d.parent;
    if (ts.isClassDeclaration(cls) && cls.name) return `${cls.name.text}.${d.name.text}`;
    return d.name.text;
  }
  return undefined;
}

export function buildFacts(root: string, files: string[], opts: { followTypes?: boolean } = {}): FnFact[] {
  const program = ts.createProgram(files.map((f) => `${root}/${f}`), {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true, allowJs: true, noEmit: true, skipLibCheck: true, types: []
  });
  const checker = program.getTypeChecker();
  const rel = (p: string) => relative(root, p);
  const wanted = new Set(files.map((f) => `${root}/${f}`));
  const facts: FnFact[] = [];

  const resolveCallee = (expr: import("typescript").Expression): { decl: import("typescript").Declaration; via: "symbol" | "type" } | undefined => {
    let sym = checker.getSymbolAtLocation(expr);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    const d = sym?.declarations?.[0];
    if (d && (ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d) || (ts.isVariableDeclaration(d) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)))))
      return { decl: d, via: "symbol" };
    if (opts.followTypes !== false) {
      const t = checker.getTypeAtLocation(expr);
      const td = t.getSymbol()?.declarations?.[0];
      if (td && (ts.isFunctionDeclaration(td) || ts.isMethodDeclaration(td))) return { decl: td, via: "type" };
      if (td && (ts.isArrowFunction(td) || ts.isFunctionExpression(td)) && ts.isVariableDeclaration(td.parent)) return { decl: td.parent, via: "type" };
    }
    return undefined;
  };

  for (const sf of program.getSourceFiles()) {
    if (!wanted.has(sf.fileName)) continue;
    const importsInFile = sf.statements.filter(ts.isImportDeclaration).length;
    const record = (name: string, node: import("typescript").Node, body: import("typescript").Node | undefined) => {
      const fact: FnFact = { file: rel(sf.fileName), name, node, calls: [], throws: 0, io: [], importsInFile };
      const visit = (n: import("typescript").Node) => {
        if (ts.isThrowStatement(n)) fact.throws++;
        if (ts.isCallExpression(n)) {
          const text = n.expression.getText(sf);
          if (IO_RE.test(text)) fact.io.push(text);
          const r = resolveCallee(n.expression);
          if (r) {
            const dn = declName(r.decl);
            const f = r.decl.getSourceFile().fileName;
            if (dn && wanted.has(f)) {
              let p: import("typescript").Node = n.parent;
              while (ts.isParenthesizedExpression(p)) p = p.parent;
              fact.calls.push({ file: rel(f), name: dn, awaited: ts.isAwaitExpression(p), via: r.via });
            }
          }
        }
        n.forEachChild(visit);
      };
      body?.forEachChild(visit);
      facts.push(fact);
    };
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name) record(st.name.text, st, st.body);
      if (ts.isVariableStatement(st))
        for (const d of st.declarationList.declarations)
          if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)))
            record(d.name.text, d, d.initializer.body);
      if (ts.isClassDeclaration(st) && st.name)
        for (const m of st.members)
          if (ts.isMethodDeclaration(m) && m.name && ts.isIdentifier(m.name)) record(`${st.name.text}.${m.name.text}`, m, m.body);
    }
  }
  return facts;
}
