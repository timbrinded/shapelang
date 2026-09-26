export const SOURCE_LANGUAGES = [
  "javascript",
  "typescript",
  "tsx",
  "rust",
  "go",
  "python",
  "swift"
] as const;

export type SourceLanguageName = (typeof SOURCE_LANGUAGES)[number];

export type SourceLanguageAlias = "js" | "jsx" | "ts" | "rs" | "py";

export type SourceLanguageInput = SourceLanguageName | SourceLanguageAlias;

export const AST_SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".rs",
  ".go",
  ".py",
  ".swift"
] as const;

const AST_LANGUAGE_BY_EXTENSION = new Map<string, SourceLanguageName>([
  [".tsx", "tsx"],
  [".mts", "typescript"],
  [".cts", "typescript"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".rs", "rust"],
  [".go", "go"],
  [".py", "python"],
  [".swift", "swift"]
]);

export function inferAstSourceLanguageFromPath(path: string): SourceLanguageName | undefined {
  if (path.endsWith(".ts")) return "typescript";
  return AST_LANGUAGE_BY_EXTENSION.get(path.slice(path.lastIndexOf(".")));
}

export function parseSourceLanguageName(language: string): SourceLanguageName | undefined {
  const lower = language.toLowerCase();
  if (isSourceLanguageName(lower)) {
    return lower;
  }
  switch (lower) {
    case "js":
    case "jsx":
      return "javascript";
    case "ts":
      return "typescript";
    case "rs":
      return "rust";
    case "py":
      return "python";
    default:
      return undefined;
  }
}

export function isSourceLanguageName(language: string): language is SourceLanguageName {
  return SOURCE_LANGUAGES.includes(language as SourceLanguageName);
}
