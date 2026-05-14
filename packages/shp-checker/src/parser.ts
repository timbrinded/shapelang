import { resolve } from "node:path";
import { URI, type LangiumDocument } from "langium";
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

type LexerErrorLike = {
  message: string;
  line?: number;
  column?: number;
};

type ParserErrorLike = {
  message: string;
  token?: {
    startLine?: number;
    startColumn?: number;
  };
};

export function parseShapeModule(source: string, filePath = "memory.shp"): ParseShapeModuleResult {
  const services = createShapeServices();
  const absolutePath = resolve(filePath);
  const document = services.shared.workspace.LangiumDocumentFactory.fromString<ShapeModule>(
    source,
    URI.file(absolutePath)
  );
  const lexerErrors = document.parseResult.lexerErrors.map((error) =>
    lexerDiagnostic(error as LexerErrorLike, filePath)
  );
  const parserErrors = document.parseResult.parserErrors.map((error) =>
    parserDiagnostic(error as ParserErrorLike, filePath)
  );
  const diagnostics = [...lexerErrors, ...parserErrors];

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

function lexerDiagnostic(error: LexerErrorLike, filePath: string): ParseDiagnostic {
  return {
    kind: "parse",
    filePath,
    message: error.message,
    line: error.line,
    column: error.column
  };
}

function parserDiagnostic(error: ParserErrorLike, filePath: string): ParseDiagnostic {
  return {
    kind: "parse",
    filePath,
    message: error.message,
    line: error.token?.startLine,
    column: error.token?.startColumn
  };
}
