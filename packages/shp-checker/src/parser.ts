import { resolve } from "node:path";
import { DocumentState, TextDocument, URI, type LangiumDocument, type Mutable } from "langium";
import type { ShapeModule } from "./language/generated/ast.ts";
import { createShapeServices } from "./language/shape-module.ts";

export type ParseDiagnostic = {
  kind: "parse";
  filePath: string;
  message: string;
  line?: number;
  column?: number;
};

export type ParseShapeModuleResult =
  | {
      ok: true;
      filePath: string;
      module: ShapeModule;
      document: LangiumDocument<ShapeModule>;
    }
  | {
      ok: false;
      filePath: string;
      diagnostics: ParseDiagnostic[];
    };

export function parseShapeModule(
  source: string,
  filePath = "memory.shape"
): ParseShapeModuleResult {
  const services = createShapeServices();
  const absolutePath = resolve(filePath);
  const uri = URI.file(absolutePath);
  const parseResult = services.Shape.parser.LangiumParser.parse<ShapeModule>(source);
  const document: LangiumDocument<ShapeModule> = {
    parseResult,
    uri,
    state: DocumentState.Parsed,
    references: [],
    textDocument: TextDocument.create(uri.toString(), "shape", 0, source)
  };
  (parseResult.value as Mutable<ShapeModule>).$document = document;
  const diagnostics: ParseDiagnostic[] = [
    ...parseResult.lexerErrors.map<ParseDiagnostic>((error) => ({
      kind: "parse",
      filePath,
      message: error.message,
      line: error.line,
      column: error.column
    })),
    ...parseResult.parserErrors.map<ParseDiagnostic>((error) => ({
      kind: "parse",
      filePath,
      message: error.message,
      line: error.token.startLine,
      column: error.token.startColumn
    }))
  ];

  if (diagnostics.length > 0) {
    return {
      ok: false,
      filePath,
      diagnostics
    };
  }

  return {
    ok: true,
    filePath,
    module: document.parseResult.value,
    document
  };
}
