export type TreeSitterNativeBindingPackageSpecifier =
  | "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.linux-x64-gnu.node"
  | "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.linux-arm64-gnu.node"
  | "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.darwin-arm64.node"
  | "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.win32-x64-msvc.node";

export type TreeSitterNativeBindingEmbeddedSpecifier =
  | "./ts-pack-core-node.linux-x64-gnu.node"
  | "./ts-pack-core-node.linux-arm64-gnu.node"
  | "./ts-pack-core-node.darwin-arm64.node"
  | "./ts-pack-core-node.win32-x64-msvc.node";

export type TreeSitterNativeBindingTarget = {
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly bunTarget: string;
  readonly releaseName: string;
  readonly packageSpecifier: TreeSitterNativeBindingPackageSpecifier;
  readonly embeddedSpecifier: TreeSitterNativeBindingEmbeddedSpecifier;
};

export const TREE_SITTER_NATIVE_BINDING_TARGETS = [
  {
    platform: "linux",
    arch: "x64",
    bunTarget: "bun-linux-x64-baseline",
    releaseName: "shp-linux-x64",
    packageSpecifier: "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.linux-x64-gnu.node",
    embeddedSpecifier: "./ts-pack-core-node.linux-x64-gnu.node"
  },
  {
    platform: "linux",
    arch: "arm64",
    bunTarget: "bun-linux-arm64",
    releaseName: "shp-linux-arm64",
    packageSpecifier: "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.linux-arm64-gnu.node",
    embeddedSpecifier: "./ts-pack-core-node.linux-arm64-gnu.node"
  },
  {
    platform: "darwin",
    arch: "arm64",
    bunTarget: "bun-darwin-arm64",
    releaseName: "shp-darwin-arm64",
    packageSpecifier: "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.darwin-arm64.node",
    embeddedSpecifier: "./ts-pack-core-node.darwin-arm64.node"
  },
  {
    platform: "win32",
    arch: "x64",
    bunTarget: "bun-windows-x64-baseline",
    releaseName: "shp-windows-x64",
    packageSpecifier: "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.win32-x64-msvc.node",
    embeddedSpecifier: "./ts-pack-core-node.win32-x64-msvc.node"
  }
] as const satisfies readonly TreeSitterNativeBindingTarget[];

export function currentTreeSitterNativeBindingTarget(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch
): TreeSitterNativeBindingTarget | undefined {
  return TREE_SITTER_NATIVE_BINDING_TARGETS.find(
    (target) => target.platform === platform && target.arch === arch
  );
}

export function treeSitterNativePackageSpecifiers(): TreeSitterNativeBindingPackageSpecifier[] {
  return TREE_SITTER_NATIVE_BINDING_TARGETS.map((target) => target.packageSpecifier);
}
