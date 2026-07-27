export type ModuleReferenceContext = {
  moduleName?: string;
  imports: readonly string[];
};

export type ModuleReferenceResolution =
  | { kind: "resolved"; name: string }
  | { kind: "unknown"; name: string }
  | { kind: "ambiguous"; name: string; matches: string[] };

type DeclarationLookup = (moduleName: string | undefined, localName: string) => boolean;

export function qualifyModuleReference(moduleName: string | undefined, localName: string): string {
  return moduleName ? `${moduleName}::${localName}` : localName;
}

export function splitModuleReference(name: string): {
  moduleName?: string;
  localName: string;
} {
  const separator = name.lastIndexOf("::");
  if (separator < 0) {
    return { localName: name };
  }
  return {
    moduleName: name.slice(0, separator),
    localName: name.slice(separator + 2)
  };
}

export function resolveModuleReference(
  name: string,
  context: ModuleReferenceContext,
  isDeclared: DeclarationLookup
): ModuleReferenceResolution {
  const qualified = splitModuleReference(name);
  if (qualified.moduleName !== undefined) {
    return {
      kind: "resolved",
      name: qualifyModuleReference(qualified.moduleName, qualified.localName)
    };
  }

  if (isDeclared(context.moduleName, name)) {
    return { kind: "resolved", name: qualifyModuleReference(context.moduleName, name) };
  }

  const importedMatches = context.imports
    .filter((moduleName) => isDeclared(moduleName, name))
    .map((moduleName) => qualifyModuleReference(moduleName, name))
    .sort();
  if (importedMatches.length > 1) {
    return {
      kind: "ambiguous",
      name: qualifyModuleReference(context.moduleName, name),
      matches: importedMatches
    };
  }
  return importedMatches[0]
    ? { kind: "resolved", name: importedMatches[0] }
    : { kind: "unknown", name: qualifyModuleReference(context.moduleName, name) };
}

export function splitFunctionReference(target: string): [string | undefined, string | undefined] {
  const separator = target.lastIndexOf(".");
  if (separator <= 0 || separator === target.length - 1) {
    return [undefined, undefined];
  }
  return [target.slice(0, separator), target.slice(separator + 1)];
}
