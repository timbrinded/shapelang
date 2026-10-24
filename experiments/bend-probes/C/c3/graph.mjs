// Deterministic call graph and effect-site extraction over the repository's
// TypeScript, using the TypeScript compiler API (shared by C3 and C4).
//
// A "unit" is an analysable declaration: a function, method, constructor,
// accessor, module-level variable initializer, class (constructor plus field
// initializers) or function-valued property. For each unit we record, from its
// body (nested closures included):
//   sites   - I/O operations, classified into channels (see classify())
//   throws  - throw statements and calls to throwing built-ins, with a flag for
//             "lexically inside a try block that has a catch clause"
//   edges   - repo-local units it calls, constructs, references as a value
//             (callbacks, handler tables) or loads with import("./x")
//   unknown - calls the graph cannot resolve (interface methods, untyped or
//             callback-parameter callees)
import { join, relative } from "node:path";
import { REPO, req } from "../lib/work.mjs";

export const ts = req("typescript");

export function buildProgram(extraRoots = [], extraLocalDirs = []) {
  const cfg = ts.readConfigFile(join(REPO, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, REPO);
  const roots = parsed.fileNames
    .filter((f) => !f.includes("/experiments/bend-probes/"))
    .concat(extraRoots);
  const options = {
    ...parsed.options,
    types: ["bun"],
    typeRoots: [join(REPO, "node_modules/.bun/@types+bun@1.4.2/node_modules/@types")],
    noEmit: true
  };
  const program = ts.createProgram(roots, options);
  const checker = program.getTypeChecker();
  const isLocalFile = (fileName) =>
    !fileName.endsWith(".d.ts") &&
    !fileName.includes("/node_modules/") &&
    (fileName.startsWith(`${REPO}/`) || extraLocalDirs.some((d) => fileName.startsWith(`${d}/`)));
  return {
    program,
    checker,
    options,
    isLocalFile,
    rel: (f) => (f.startsWith(`${REPO}/`) ? relative(REPO, f) : f)
  };
}

const FS_WRITE = new Set([
  "writeFileSync",
  "writeFile",
  "appendFileSync",
  "appendFile",
  "mkdirSync",
  "mkdir",
  "rmSync",
  "rm",
  "rmdirSync",
  "rmdir",
  "unlinkSync",
  "unlink",
  "renameSync",
  "rename",
  "copyFileSync",
  "copyFile",
  "cpSync",
  "cp",
  "mkdtempSync",
  "mkdtemp",
  "createWriteStream",
  "chmodSync",
  "chmod",
  "symlinkSync",
  "symlink",
  "truncateSync",
  "truncate",
  "utimesSync"
]);
const PURE_MODULES = new Set([
  "path",
  "url",
  "util",
  "events",
  "buffer",
  "string_decoder",
  "querystring",
  "zlib",
  "stream"
]);

// Classifies a resolved access chain into an I/O channel, a throwing built-in,
// or null (pure). chain[0] is "module:<specifier>" or "global:<name>".
export function classify(chain, { isCall, isNew, argCount, firstArgLiteral }) {
  const [root, a] = chain;
  if (root.startsWith("module:")) {
    const spec = root.slice(7).replace(/^node:/, "");
    if (spec === "fs" || spec === "fs/promises")
      return { channel: FS_WRITE.has(a) ? "fs-write" : "fs-read" };
    if (spec === "child_process") return { channel: "subprocess" };
    if (["http", "https", "net", "dgram", "tls", "dns", "http2"].includes(spec))
      return { channel: "network" };
    if (spec === "os") return { channel: "env" };
    if (spec === "readline") return { channel: "stdio" };
    if (spec === "module") return a === "createRequire" ? { channel: "module-load" } : null;
    if (spec === "crypto")
      return ["randomBytes", "randomUUID", "getRandomValues", "randomInt"].includes(a)
        ? { channel: "random" }
        : null;
    if (spec === "assert" || spec === "assert/strict")
      return isCall || a === undefined ? { throws: "assert" } : null;
    if (spec === "worker_threads") return { channel: "process" };
    if (spec === "bun") {
      if (["$", "spawn", "spawnSync"].includes(a)) return { channel: "subprocess" };
      if (a === "file" || a === "Glob") return { channel: "fs-read" };
      if (a === "write") return { channel: "fs-write" };
      if (a === "env") return { channel: "env" };
      return { channel: "bun-other" };
    }
    if (spec === "bun:sqlite") return { channel: "fs-write" };
    if (spec === "bun:test") return null;
    if (PURE_MODULES.has(spec)) return null;
    if (spec === "vscode-languageserver/node")
      return a === "createConnection" ? { channel: "stdio" } : null;
    if (spec === "langium/node") return { channel: "fs-read" };
    return { external: `${spec}${a ? `.${a}` : ""}` };
  }
  const name = root.slice(7);
  switch (name) {
    case "process": {
      if (a === "env") return { channel: "env" };
      if (
        [
          "argv",
          "cwd",
          "platform",
          "arch",
          "execPath",
          "version",
          "versions",
          "pid",
          "ppid",
          "execArgv",
          "memoryUsage"
        ].includes(a)
      )
        return { channel: "env" };
      if (["stdout", "stderr", "stdin"].includes(a)) return { channel: "stdio" };
      if (["hrtime", "uptime"].includes(a)) return { channel: "clock" };
      if (a === "nextTick") return { channel: "timer" };
      return { channel: "process" };
    }
    case "console":
      return { channel: "stdio" };
    case "Date":
      if (a === "now") return { channel: "clock" };
      if (a === undefined && ((isNew && argCount === 0) || (isCall && !isNew)))
        return { channel: "clock" };
      return null;
    case "performance":
      return a === "now" ? { channel: "clock" } : null;
    case "Math":
      return a === "random" ? { channel: "random" } : null;
    case "crypto":
      return ["randomUUID", "getRandomValues"].includes(a) ? { channel: "random" } : null;
    case "fetch":
    case "XMLHttpRequest":
    case "WebSocket":
    case "EventSource":
      return { channel: "network" };
    case "Bun": {
      if (a === "file" || a === "Glob") return { channel: "fs-read" };
      if (a === "write") return { channel: "fs-write" };
      if (["spawn", "spawnSync", "$"].includes(a)) return { channel: "subprocess" };
      if (["env", "argv", "main", "which", "cwd"].includes(a)) return { channel: "env" };
      if (["serve", "connect", "listen", "udpSocket"].includes(a)) return { channel: "network" };
      if (a === "nanoseconds") return { channel: "clock" };
      if (["stdin", "stdout", "stderr"].includes(a)) return { channel: "stdio" };
      if (["sleep", "sleepSync"].includes(a)) return { channel: "timer" };
      if (
        [
          "hash",
          "CryptoHasher",
          "deepEquals",
          "escapeHTML",
          "inspect",
          "stringWidth",
          "version",
          "revision",
          "semver",
          "SHA256",
          "SHA1",
          "MD5",
          "Transpiler",
          "fileURLToPath",
          "pathToFileURL"
        ].includes(a)
      )
        return null;
      return { channel: "bun-other" };
    }
    case "setTimeout":
    case "setInterval":
    case "setImmediate":
      return { channel: "timer" };
    case "require":
      return { channel: "module-load" };
    case "JSON":
      return a === "parse" && isCall ? { throws: "JSON.parse" } : null;
    case "URL":
      return isNew && a === undefined ? { throws: "new URL" } : null;
    case "decodeURIComponent":
    case "decodeURI":
    case "atob":
    case "structuredClone":
    case "BigInt":
      return isCall && a === undefined ? { throws: name } : null;
    case "RegExp":
      return (isNew || isCall) && a === undefined && !firstArgLiteral
        ? { throws: "RegExp(dynamic)" }
        : null;
    default:
      return null;
  }
}

export function createGraph(env) {
  const { checker, isLocalFile, rel, options } = env;
  const units = new Map(); // node -> facts
  const keyOf = (node) => {
    const sf = node.getSourceFile();
    const name =
      node.name && ts.isIdentifier(node.name)
        ? node.name.text
        : node.name
          ? node.name.getText(sf)
          : ts.SyntaxKind[node.kind];
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return `${rel(sf.fileName)}#${name}:${line + 1}`;
  };

  const isModuleScopeVar = (decl) =>
    ts.isVariableDeclaration(decl) &&
    ts.isVariableDeclarationList(decl.parent) &&
    ts.isVariableStatement(decl.parent.parent) &&
    ts.isSourceFile(decl.parent.parent.parent);

  function unitOf(decl) {
    if (!decl || !isLocalFile(decl.getSourceFile().fileName)) return null;
    if (
      (ts.isFunctionDeclaration(decl) ||
        ts.isMethodDeclaration(decl) ||
        ts.isGetAccessorDeclaration(decl) ||
        ts.isSetAccessorDeclaration(decl)) &&
      decl.body
    )
      return decl;
    if (ts.isConstructorDeclaration(decl) && decl.body) return decl;
    if (ts.isClassDeclaration(decl) || ts.isClassExpression(decl)) return decl;
    if (isModuleScopeVar(decl) && decl.initializer) return decl;
    if (
      (ts.isPropertyDeclaration(decl) || ts.isPropertyAssignment(decl)) &&
      decl.initializer &&
      (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
    )
      return decl;
    if (ts.isFunctionExpression(decl) || ts.isArrowFunction(decl)) return decl;
    return null;
  }

  function bodiesOf(unit) {
    if (ts.isClassDeclaration(unit) || ts.isClassExpression(unit)) {
      return unit.members.filter(
        (m) =>
          ts.isConstructorDeclaration(m) ||
          (ts.isPropertyDeclaration(m) && m.initializer) ||
          ts.isClassStaticBlockDeclaration(m)
      );
    }
    if (
      ts.isVariableDeclaration(unit) ||
      ts.isPropertyDeclaration(unit) ||
      ts.isPropertyAssignment(unit)
    )
      return [unit.initializer];
    // Default parameter values run as part of the call.
    return [...(unit.parameters ?? []).map((p) => p.initializer).filter(Boolean), unit.body];
  }

  function resolveSymbol(sym) {
    if (sym && sym.flags & ts.SymbolFlags.Alias) {
      try {
        return checker.getAliasedSymbol(sym);
      } catch {
        return sym;
      }
    }
    return sym;
  }

  function importOf(sym) {
    for (const d of sym?.declarations ?? []) {
      let imp = null;
      let imported = null;
      if (ts.isImportSpecifier(d)) {
        imp = d.parent.parent.parent;
        imported = (d.propertyName ?? d.name).text;
      } else if (ts.isNamespaceImport(d)) imp = d.parent.parent;
      else if (ts.isImportClause(d)) {
        imp = d.parent;
        imported = "default";
      }
      if (imp && ts.isImportDeclaration(imp) && ts.isStringLiteral(imp.moduleSpecifier)) {
        return { spec: imp.moduleSpecifier.text, imported, namespace: ts.isNamespaceImport(d) };
      }
    }
    return null;
  }

  const isRepoSpecifier = (spec) =>
    spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@shape/");

  function isDeclName(id) {
    const p = id.parent;
    if (ts.isPropertyAccessExpression(p)) return false;
    if (ts.isBindingElement(p) && p.propertyName === id) return true;
    if (ts.isQualifiedName(p)) return true;
    return "name" in p && p.name === id;
  }

  function analyze(unit) {
    if (units.has(unit)) return units.get(unit);
    const sf = unit.getSourceFile();
    const facts = {
      key: keyOf(unit),
      file: rel(sf.fileName),
      sites: [],
      throws: [],
      edges: [],
      unknown: [],
      external: []
    };
    units.set(unit, facts);
    const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const text = (node) => node.getText(sf).replace(/\s+/g, " ").slice(0, 80);
    const addEdge = (decl, kind, node, caught) => {
      const target = unitOf(decl);
      if (target && target !== unit) facts.edges.push({ target, kind, caught, line: at(node) });
    };

    function onIdentifier(id, caught) {
      if (ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id) {
        const value = resolveSymbol(checker.getShorthandAssignmentValueSymbol(id.parent));
        for (const d of value?.declarations ?? []) addEdge(d, "ref", id, caught);
        return;
      }
      if (isDeclName(id)) return;
      let top = id;
      const names = [];
      while (true) {
        const p = top.parent;
        if (ts.isPropertyAccessExpression(p) && p.expression === top) names.push(p.name.text);
        else if (ts.isElementAccessExpression(p) && p.expression === top) names.push("[]");
        else if (ts.isNonNullExpression(p) || ts.isParenthesizedExpression(p)) {
          top = p;
          continue;
        } else break;
        top = p;
      }
      const parent = top.parent;
      const call =
        (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === top
          ? parent
          : null;
      const ctx = {
        isCall: call !== null && ts.isCallExpression(call),
        isNew: call !== null && ts.isNewExpression(call),
        argCount: call?.arguments?.length ?? 0,
        firstArgLiteral:
          call?.arguments?.[0] !== undefined && ts.isStringLiteralLike(call.arguments[0])
      };
      const sym = checker.getSymbolAtLocation(id);
      const imp = importOf(sym);
      let chain = null;
      if (imp && !isRepoSpecifier(imp.spec)) {
        chain =
          imp.namespace || imp.imported === "default"
            ? [`module:${imp.spec}`, ...names]
            : [`module:${imp.spec}`, imp.imported, ...names];
      } else if (!imp) {
        const decls = sym?.declarations ?? [];
        if (decls.every((d) => !isLocalFile(d.getSourceFile().fileName)))
          chain = [`global:${id.text}`, ...names];
      }
      if (chain) {
        const c = classify(chain, ctx);
        if (c?.channel)
          facts.sites.push({
            channel: c.channel,
            api: chain.join(".").replace(/^(module|global):/, ""),
            line: at(id),
            text: text(top)
          });
        if (c?.throws) facts.throws.push({ kind: c.throws, caught, line: at(id), text: text(top) });
        if (c?.external) facts.external.push({ api: c.external, line: at(id) });
        return;
      }
      const target = resolveSymbol(sym);
      for (const d of target?.declarations ?? []) {
        if (ts.isSourceFile(d) || ts.isModuleDeclaration(d)) continue; // namespace import: members resolve via property names
        if (
          ts.isParameter(d) ||
          (ts.isVariableDeclaration(d) && !isModuleScopeVar(d)) ||
          ts.isBindingElement(d)
        ) {
          if (ctx.isCall && names.length === 0)
            facts.unknown.push({ kind: "callback-or-local", line: at(id), text: text(top) });
          continue;
        }
        if (names.length === 0)
          addEdge(d, ctx.isCall ? "call" : ctx.isNew ? "new" : "ref", id, caught);
        else addEdge(d, "ref", id, caught);
      }
    }

    function onPropertyName(pa, caught) {
      const callee = ts.isCallExpression(pa.parent) && pa.parent.expression === pa;
      const sym = resolveSymbol(checker.getSymbolAtLocation(pa.name));
      const decls = sym?.declarations ?? [];
      let local = false;
      for (const d of decls) {
        const target = unitOf(d);
        if (target) {
          local = true;
          addEdge(d, callee ? "call" : "ref", pa, caught);
        }
      }
      if (!local && callee) {
        if (decls.length === 0) {
          const recvType = checker.getTypeAtLocation(pa.expression);
          if (recvType.flags & ts.TypeFlags.Any)
            facts.unknown.push({ kind: "untyped-receiver", line: at(pa), text: text(pa) });
        } else if (
          decls.some(
            (d) =>
              isLocalFile(d.getSourceFile().fileName) &&
              (ts.isMethodSignature(d) ||
                ts.isPropertySignature(d) ||
                ts.isPropertyDeclaration(d) ||
                ts.isPropertyAssignment(d) ||
                ts.isShorthandPropertyAssignment(d))
          )
        ) {
          facts.unknown.push({ kind: "interface-or-field-call", line: at(pa), text: text(pa) });
        }
      }
    }

    function onImportCall(node) {
      const arg = node.arguments[0];
      if (!arg || !ts.isStringLiteralLike(arg)) {
        facts.sites.push({
          channel: "module-load",
          api: "import(dynamic)",
          line: at(node),
          text: text(node)
        });
        return;
      }
      const resolved = ts.resolveModuleName(arg.text, sf.fileName, options, ts.sys).resolvedModule;
      const target = resolved && env.program.getSourceFile(resolved.resolvedFileName);
      if (target && isLocalFile(target.fileName)) {
        for (const st of target.statements) {
          const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
          if (!exported) continue;
          if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st))
            addEdge(st, "dynimport", node, false);
          if (ts.isVariableStatement(st))
            for (const d of st.declarationList.declarations) addEdge(d, "dynimport", node, false);
        }
      } else {
        facts.sites.push({
          channel: "module-load",
          api: `import(${arg.text})`,
          line: at(node),
          text: text(node)
        });
      }
    }

    function walk(node, caught) {
      if (!node) return;
      if (
        ts.isTypeNode(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isImportDeclaration(node)
      )
        return;
      if (ts.isTryStatement(node)) {
        walk(node.tryBlock, caught || node.catchClause !== undefined);
        if (node.catchClause) walk(node.catchClause.block, caught);
        if (node.finallyBlock) walk(node.finallyBlock, caught);
        return;
      }
      if (ts.isThrowStatement(node))
        facts.throws.push({ kind: "throw", caught, line: at(node), text: text(node) });
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        onImportCall(node);
      if (
        ts.isMetaProperty(node) &&
        node.keywordToken === ts.SyntaxKind.ImportKeyword &&
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.name.text === "env"
      ) {
        facts.sites.push({
          channel: "env",
          api: "import.meta.env",
          line: at(node),
          text: text(node.parent)
        });
      }
      if (ts.isIdentifier(node)) onIdentifier(node, caught);
      if (ts.isPropertyAccessExpression(node)) onPropertyName(node, caught);
      ts.forEachChild(node, (child) => walk(child, caught));
    }
    for (const body of bodiesOf(unit)) walk(body, false);
    return facts;
  }

  // Breadth-first closure. Returns per-unit depth for all edges, and for edges
  // not lexically inside try/catch (for throw propagation).
  function closure(start, { maxDepth = Infinity, stop = () => false } = {}) {
    const depthAll = new Map([[start, 0]]);
    const depthUncaught = new Map([[start, 0]]);
    const parent = new Map();
    for (const [map, useCaught] of [
      [depthAll, true],
      [depthUncaught, false]
    ]) {
      const queue = [start];
      while (queue.length) {
        const u = queue.shift();
        const d = map.get(u);
        if (d >= maxDepth || (u !== start && stop(u))) continue;
        for (const e of analyze(u).edges) {
          if (!useCaught && e.caught) continue;
          if (!map.has(e.target)) {
            map.set(e.target, d + 1);
            if (useCaught) parent.set(e.target, { from: u, kind: e.kind, line: e.line });
            queue.push(e.target);
          }
        }
      }
    }
    const pathTo = (u) => {
      const out = [];
      for (let cur = u; cur !== start && parent.has(cur); cur = parent.get(cur).from) {
        const p = parent.get(cur);
        out.unshift(`${analyze(p.from).key} -${p.kind}@${p.line}-> ${analyze(cur).key}`);
      }
      return out;
    };
    return { depthAll, depthUncaught, pathTo };
  }

  return { analyze, closure, unitOf, keyOf };
}

// Finds the declaration named by a `path#symbol` source reference: a top-level
// function, variable or class, else a uniquely named class member.
export function findSourceUnit(env, graph, file, symbol) {
  const sf = env.program.getSourceFile(file);
  if (!sf) return { error: "file not in program" };
  const hits = [];
  for (const st of sf.statements) {
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name?.text === symbol)
      hits.push(st);
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.name.text === symbol) hits.push(d);
  }
  if (hits.length === 0) {
    for (const st of sf.statements) {
      if (!ts.isClassDeclaration(st)) continue;
      for (const m of st.members)
        if (
          m.name &&
          ts.isIdentifier(m.name) &&
          m.name.text === symbol &&
          ts.isMethodDeclaration(m)
        )
          hits.push(m);
    }
  }
  const units = hits.map((h) => graph.unitOf(h)).filter(Boolean);
  if (units.length === 0) return { error: "symbol not found" };
  return { unit: units[units.length - 1], overloads: units.length };
}
