// C5: do off-the-shelf type checking and lint flag the cross-object bug?
// Base = base/catalog.ts + candidate/presenter.ts (base/ holds only the changed
// file); candidate = candidate/. Writes $CWORK/c5/transcript.md with every
// command, its exit code and its exact output. Usage: bun run-c5.mjs
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO, WORK } from "../lib/work.mjs";

const OUT = join(WORK, "c5");
const BIN = join(WORK, "node_modules/.bin");
const src = join(REPO, "fixtures/skills/review/cross-object");
const tsconfig = {
  compilerOptions: {
    target: "ESNext", module: "Preserve", moduleResolution: "bundler", lib: ["ESNext"], types: [], noEmit: true,
    strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noImplicitReturns: true,
    noFallthroughCasesInSwitch: true, noUnusedLocals: true, noUnusedParameters: true, noImplicitOverride: true,
    noPropertyAccessFromIndexSignature: true, allowUnreachableCode: false, allowUnusedLabels: false
  },
  include: ["*.ts"]
};
const eslintAll = `import tseslint from "typescript-eslint";
export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } }
);
`;
const eslintFocused = `import tseslint from "typescript-eslint";
export default tseslint.config({
  files: ["**/*.ts"],
  languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  plugins: { "@typescript-eslint": tseslint.plugin },
  rules: {
    "@typescript-eslint/no-unnecessary-condition": "error",
    "@typescript-eslint/strict-boolean-expressions": "error",
    "@typescript-eslint/no-unnecessary-type-assertion": "error",
    "@typescript-eslint/switch-exhaustiveness-check": "error"
  }
});
`;

rmSync(OUT, { recursive: true, force: true });
const variants = {};
for (const variant of ["base", "candidate"]) {
  const dir = join(OUT, variant);
  mkdirSync(dir, { recursive: true });
  cpSync(join(src, "candidate"), dir, { recursive: true });
  if (variant === "base") cpSync(join(src, "base"), dir, { recursive: true });
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
  writeFileSync(join(dir, "eslint.config.mjs"), eslintAll);
  writeFileSync(join(dir, "eslint.focused.config.mjs"), eslintFocused);
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify({ plugins: ["typescript", "unicorn", "oxc", "import"] }));
  variants[variant] = dir;
}

const FILES = ["catalog.ts", "presenter.ts"];
const tools = [
  ["tsc 5.9.3 --strict (+ all strictness flags in tsconfig)", [join(BIN, "tsc"), "-p", "tsconfig.json"]],
  ["tsgo 7.0 native preview (repo) --strict", [join(REPO, "node_modules/.bin/tsgo"), "-p", "tsconfig.json"]],
  ["oxlint 1.66.0 with the repository's .oxlintrc.json --deny-warnings (as `bun run lint`)", [join(REPO, "node_modules/.bin/oxlint"), "-c", join(REPO, ".oxlintrc.json"), "--deny-warnings", ...FILES]],
  ["oxlint 1.66.0 -W all -W nursery (typescript, unicorn, oxc, import plugins)", [join(BIN, "oxlint"), "-W", "all", "-W", "nursery", ...FILES]],
  ["oxlint 1.66.0 --type-aware -W all (oxlint-tsgolint 7.0.2005)", [join(BIN, "oxlint"), "--type-aware", "-W", "all", ...FILES]],
  ["oxlint 1.66.0 --type-aware -W all -W nursery (oxlint-tsgolint 7.0.2005)", [join(BIN, "oxlint"), "--type-aware", "-W", "all", "-W", "nursery", ...FILES]],
  ["oxlint 1.66.0 --type-aware, only typescript/no-unnecessary-condition", [join(BIN, "oxlint"), "--type-aware", "-A", "all", "-D", "typescript/no-unnecessary-condition", ...FILES]],
  ["eslint 9.37.0 + typescript-eslint 8.46.0 strictTypeChecked + stylisticTypeChecked", [join(BIN, "eslint"), ...FILES]],
  ["eslint 9.37.0 + typescript-eslint 8.46.0 focused typed rules", [join(BIN, "eslint"), "-c", "eslint.focused.config.mjs", ...FILES]],
  ["eslint focused typed rules on the changed file only (catalog.ts)", [join(BIN, "eslint"), "-c", "eslint.focused.config.mjs", "catalog.ts"]]
];

const lines = ["# C5 transcript", ""];
const summary = [];
for (const [label, cmd] of tools) {
  for (const [variant, dir] of Object.entries(variants)) {
    const r = spawnSync(cmd[0], cmd.slice(1), { cwd: dir, encoding: "utf8" });
    const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.replaceAll(dir, `<${variant}>`).trim();
    lines.push(`## ${label} — ${variant}`, "", `\`${cmd.map((c) => c.replace(WORK, "$CWORK").replace(REPO, "<repo>")).join(" ")}\` (cwd <${variant}>)`, "", `exit ${r.status}`, "", "```", output || "(no output)", "```", "");
    summary.push({ tool: label, variant, exit: r.status, flagsDeadNullCheck: /no-unnecessary-condition/.test(output), output });
  }
}
writeFileSync(join(OUT, "transcript.md"), lines.join("\n"));
for (const s of summary) {
  console.log(`${s.variant.padEnd(9)} exit=${String(s.exit).padEnd(3)} no-unnecessary-condition=${s.flagsDeadNullCheck}  ${s.tool}`);
}
console.log(`\ntranscript: ${join(OUT, "transcript.md")}`);
