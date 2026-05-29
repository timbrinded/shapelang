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

export function inferAstSourceLanguageFromPath(path: string): string | undefined {
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
