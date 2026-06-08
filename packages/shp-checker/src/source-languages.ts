export const SOURCE_LANGUAGES = [
  "javascript",
  "typescript",
  "tsx",
  "rust",
  "go",
  "python"
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
  ".py"
] as const;

export function inferAstSourceLanguageFromPath(path: string): SourceLanguageName | undefined {
  if (path.endsWith(".ts") || path.endsWith(".mts") || path.endsWith(".cts")) {
    return "typescript";
  }
  if (path.endsWith(".tsx")) {
    return "tsx";
  }
  if (
    path.endsWith(".js") ||
    path.endsWith(".jsx") ||
    path.endsWith(".mjs") ||
    path.endsWith(".cjs")
  ) {
    return "javascript";
  }
  if (path.endsWith(".rs")) {
    return "rust";
  }
  if (path.endsWith(".go")) {
    return "go";
  }
  if (path.endsWith(".py")) {
    return "python";
  }
  return undefined;
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
