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
  const lexerErrors = document.parseResult.lexerErrors.map((error) =>
    lexerDiagnostic(error, filePath)
  );
  const parserErrors = document.parseResult.parserErrors.map((error) =>
    parserDiagnostic(error, filePath)
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

function lexerDiagnostic(error: unknown, filePath: string): ParseDiagnostic {
  return {
    kind: "parse",
    filePath,
    message: messageProperty(error),
    line: numberProperty(error, "line"),
    column: numberProperty(error, "column")
  };
}

function parserDiagnostic(error: unknown, filePath: string): ParseDiagnostic {
  const token = recordProperty(error, "token");
  return {
    kind: "parse",
    filePath,
    message: messageProperty(error),
    line: numberProperty(token, "startLine"),
    column: numberProperty(token, "startColumn")
  };
}

function messageProperty(value: unknown): string {
  const message = stringProperty(value, "message");
  return message ?? String(value);
}

function recordProperty(value: unknown, key: string): Record<string, unknown> | undefined {
  const propertyValue = isRecord(value) ? value[key] : undefined;
  return isRecord(propertyValue) ? propertyValue : undefined;
}

function stringProperty(value: unknown, key: string): string | undefined {
  const propertyValue = isRecord(value) ? value[key] : undefined;
  return typeof propertyValue === "string" ? propertyValue : undefined;
}

function numberProperty(value: unknown, key: string): number | undefined {
  const propertyValue = isRecord(value) ? value[key] : undefined;
  return typeof propertyValue === "number" ? propertyValue : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
