import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_SKILLS = [
  "shape-contract-guard",
  "shape-contract-preflight",
  "shape-index",
  "shape-lang",
  "shape-review"
] as const;

type ShippedSkill = (typeof EXPECTED_SKILLS)[number];

const LEGACY_COMMANDS = [
  "shp graph --stats",
  "shp graph --kind",
  "shp graph Gateway",
  "shp graph <Symbol>",
  "shp graph SYMBOL",
  "--allow-draft-unknown"
] as const;

const OUTPUT_CONTRACT_MARKERS: Record<ShippedSkill, readonly string[]> = {
  "shape-contract-guard": ['"impact"', '"support"', '"disposition"'],
  "shape-contract-preflight": [
    "proceed",
    "blocked_by_contract",
    "baseline_invalid",
    "tooling_unavailable"
  ],
  "shape-index": ["complete", "incomplete_with_explicit_gaps", "blocked"],
  "shape-lang": ["author", "debug", "drift-review"],
  "shape-review": ['"comments"', '"shape_model_warnings"']
};

const ROUTING_KINDS = ["direct", "indirect", "adjacent", "incomplete", "negative"] as const;

type RoutingKind = (typeof ROUTING_KINDS)[number];

interface SkillFrontmatter {
  name?: unknown;
  description?: unknown;
}

interface SkillMetadata {
  interface?: {
    default_prompt?: unknown;
    display_name?: unknown;
    short_description?: unknown;
  };
  policy?: {
    allow_implicit_invocation?: unknown;
  };
}

interface RoutingCase {
  id?: unknown;
  kind?: unknown;
  prompt?: unknown;
  expected_skill?: unknown;
}

interface BehaviorCase {
  id?: unknown;
  skill?: unknown;
  task?: unknown;
  fixture?: unknown;
  required_commands?: unknown;
}

function parseFrontmatter(contents: string, path: string): SkillFrontmatter {
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match?.[1]) {
    throw new Error(`${path}: missing YAML frontmatter`);
  }

  const parsed = Bun.YAML.parse(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: frontmatter must be a YAML mapping`);
  }
  return parsed as SkillFrontmatter;
}

function filesRecursively(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...filesRecursively(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files.sort();
}

function validateReferencedResources(
  repositoryRoot: string,
  skillName: ShippedSkill,
  skillRoot: string,
  failures: string[]
): void {
  const resourcePattern = /\b(?:references|scripts|examples)\/[A-Za-z0-9._/-]+/g;
  const textFiles = filesRecursively(skillRoot).filter((path) =>
    [".md", ".yaml", ".yml"].includes(extname(path))
  );

  for (const textFile of textFiles) {
    const contents = readFileSync(textFile, "utf8");
    for (const match of contents.matchAll(resourcePattern)) {
      const resource = match[0];
      const resourcePath = resolve(skillRoot, resource);
      if (!resourcePath.startsWith(`${resolve(skillRoot)}/`)) {
        failures.push(
          `${relative(repositoryRoot, textFile)}: resource escapes ${skillName}: ${resource}`
        );
        continue;
      }
      if (!existsSync(resourcePath)) {
        failures.push(
          `${relative(repositoryRoot, textFile)}: referenced resource does not exist: ${resource}`
        );
        continue;
      }
      if (resource.startsWith("scripts/") && statSync(resourcePath).isFile()) {
        if ((statSync(resourcePath).mode & 0o111) === 0) {
          failures.push(
            `${relative(repositoryRoot, resourcePath)}: referenced script must be executable`
          );
        }
      }
    }
  }
}

function shellCommandExamples(contents: string): string[] {
  const commands: string[] = [];
  for (const block of contents.matchAll(/```(?:bash|sh|shell)\r?\n([\s\S]*?)```/g)) {
    const logicalLines = (block[1] ?? "")
      .replace(/\\\r?\n\s*/g, " ")
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^\$\s+/, ""))
      .filter((line) => line.length > 0);
    for (const line of logicalLines) {
      if (/^(?:shp|bun shp|<SHAPE_CMD>)(?:\s|$)/.test(line)) {
        commands.push(line);
      }
    }
  }
  return commands;
}

function commandHelpRoute(command: string): { route: string[]; flags: string[] } | undefined {
  const normalized = command
    .replace(/^bun shp(?:\s|$)/, "")
    .replace(/^shp(?:\s|$)/, "")
    .replace(/^<SHAPE_CMD>(?:\s|$)/, "")
    .trim();
  if (normalized === "" || normalized.startsWith("--version")) {
    return undefined;
  }

  const tokens = normalized.split(/\s+/);
  const root = tokens[0];
  if (!root || root.startsWith("-") || root.startsWith("<")) {
    return undefined;
  }
  const route = [root];
  if ((root === "graph" || root === "ast") && tokens[1] && !tokens[1].startsWith("-")) {
    route.push(tokens[1]);
  }
  const flags = [...normalized.matchAll(/--[a-z][a-z0-9-]*/g)].map((match) => match[0]);
  return { route, flags: flags.filter((flag) => flag !== "--help") };
}

function validateCurrentCliExamples(
  repositoryRoot: string,
  skillRoot: string,
  failures: string[]
): void {
  const helpCache = new Map<string, string>();
  const markdownFiles = filesRecursively(skillRoot).filter((path) => extname(path) === ".md");

  for (const markdownFile of markdownFiles) {
    const contents = readFileSync(markdownFile, "utf8");
    for (const command of shellCommandExamples(contents)) {
      const parsed = commandHelpRoute(command);
      if (!parsed) {
        continue;
      }
      const routeKey = parsed.route.join(" ");
      let help = helpCache.get(routeKey);
      if (help === undefined) {
        const result = spawnSync("bun", ["shp", ...parsed.route, "--help"], {
          cwd: repositoryRoot,
          encoding: "utf8"
        });
        if (result.status !== 0) {
          failures.push(
            `${relative(repositoryRoot, markdownFile)}: current CLI rejects route from \`${command}\`: ${result.stderr.trim()}`
          );
          continue;
        }
        help = `${result.stdout}\n${result.stderr}`;
        helpCache.set(routeKey, help);
      }
      for (const flag of parsed.flags) {
        if (!help.includes(flag)) {
          failures.push(
            `${relative(repositoryRoot, markdownFile)}: current CLI help for \`${routeKey}\` does not contain ${flag}`
          );
        }
      }
    }
  }
}

function validateRoutingCases(
  repositoryRoot: string,
  skillsRoot: string,
  failures: string[]
): void {
  const path = join(skillsRoot, "routing-cases.json");
  const displayPath = relative(repositoryRoot, path);
  if (!existsSync(path)) {
    failures.push(`${displayPath}: missing routing cases`);
    return;
  }

  let cases: RoutingCase[];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed)) {
      failures.push(`${displayPath}: expected a JSON array`);
      return;
    }
    cases = parsed as RoutingCase[];
  } catch (error) {
    failures.push(`${displayPath}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const ids = new Set<string>();
  const kinds = new Set<RoutingKind>();
  const skillKinds = new Map<ShippedSkill, Set<RoutingKind>>(
    EXPECTED_SKILLS.map((skill) => [skill, new Set<RoutingKind>()])
  );

  for (const item of cases) {
    if (typeof item.id !== "string" || item.id.trim() === "") {
      failures.push(`${displayPath}: every case needs a non-empty id`);
      continue;
    }
    if (ids.has(item.id)) {
      failures.push(`${displayPath}: duplicate routing case id ${item.id}`);
    }
    ids.add(item.id);

    if (typeof item.kind !== "string" || !ROUTING_KINDS.includes(item.kind as RoutingKind)) {
      failures.push(`${displayPath}: ${item.id} has unknown kind ${String(item.kind)}`);
      continue;
    }
    const kind = item.kind as RoutingKind;
    kinds.add(kind);

    if (typeof item.prompt !== "string" || item.prompt.trim() === "") {
      failures.push(`${displayPath}: ${item.id} needs a non-empty prompt`);
    }

    if (item.expected_skill === null) {
      if (kind !== "negative") {
        failures.push(`${displayPath}: only negative cases may use expected_skill null`);
      }
      continue;
    }
    if (
      typeof item.expected_skill !== "string" ||
      !EXPECTED_SKILLS.includes(item.expected_skill as ShippedSkill)
    ) {
      failures.push(`${displayPath}: ${item.id} has unknown expected_skill`);
      continue;
    }
    skillKinds.get(item.expected_skill as ShippedSkill)?.add(kind);
  }

  for (const kind of ROUTING_KINDS) {
    if (!kinds.has(kind)) {
      failures.push(`${displayPath}: missing ${kind} routing case`);
    }
  }
  for (const skill of EXPECTED_SKILLS) {
    for (const kind of ["direct", "indirect", "incomplete"] as const) {
      if (!skillKinds.get(skill)?.has(kind)) {
        failures.push(`${displayPath}: ${skill} needs a ${kind} routing case`);
      }
    }
  }
}

function validateBehaviorCases(repositoryRoot: string, failures: string[]): void {
  const path = join(repositoryRoot, "fixtures/skills/cases.json");
  const displayPath = relative(repositoryRoot, path);
  if (!existsSync(path)) {
    failures.push(`${displayPath}: missing behavioral cases`);
    return;
  }

  let cases: BehaviorCase[];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed)) {
      failures.push(`${displayPath}: expected a JSON array`);
      return;
    }
    cases = parsed as BehaviorCase[];
  } catch (error) {
    failures.push(`${displayPath}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const ids = new Set<string>();
  const skillCounts = new Map<ShippedSkill, number>(EXPECTED_SKILLS.map((skill) => [skill, 0]));

  for (const item of cases) {
    if (typeof item.id !== "string" || item.id.trim() === "") {
      failures.push(`${displayPath}: every case needs a non-empty id`);
      continue;
    }
    if (ids.has(item.id)) {
      failures.push(`${displayPath}: duplicate behavioral case id ${item.id}`);
    }
    ids.add(item.id);

    if (typeof item.skill !== "string" || !EXPECTED_SKILLS.includes(item.skill as ShippedSkill)) {
      failures.push(`${displayPath}: ${item.id} has unknown skill`);
    } else {
      const skill = item.skill as ShippedSkill;
      skillCounts.set(skill, (skillCounts.get(skill) ?? 0) + 1);
    }

    if (typeof item.task !== "string" || item.task.trim() === "") {
      failures.push(`${displayPath}: ${item.id} needs a non-empty task`);
    }

    if (typeof item.fixture !== "string" || item.fixture.trim() === "") {
      failures.push(`${displayPath}: ${item.id} needs a fixture path`);
    } else {
      const fixturePath = resolve(repositoryRoot, item.fixture);
      if (!fixturePath.startsWith(`${resolve(repositoryRoot)}/`) || !existsSync(fixturePath)) {
        failures.push(`${displayPath}: ${item.id} fixture does not exist: ${item.fixture}`);
      }
    }

    if (
      !Array.isArray(item.required_commands) ||
      item.required_commands.some((command) => typeof command !== "string" || command.trim() === "")
    ) {
      failures.push(`${displayPath}: ${item.id} required_commands must be strings`);
    }
  }

  for (const skill of EXPECTED_SKILLS) {
    if (skillCounts.get(skill) !== 2) {
      failures.push(`${displayPath}: ${skill} must have exactly two behavioral cases`);
    }
  }
}

export function validateSkillPackage(repositoryRoot: string): string[] {
  const failures: string[] = [];
  const skillsRoot = join(repositoryRoot, "plugins/shapelang/skills");
  const actualSkills = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(skillsRoot, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();

  if (actualSkills.join("\n") !== [...EXPECTED_SKILLS].sort().join("\n")) {
    failures.push(
      `expected shipped skills ${EXPECTED_SKILLS.join(", ")}; found ${actualSkills.join(", ")}`
    );
  }

  for (const skillNameText of actualSkills) {
    const skillName = skillNameText as ShippedSkill;
    const skillRoot = join(skillsRoot, skillName);
    const skillPath = join(skillRoot, "SKILL.md");
    const displayPath = relative(repositoryRoot, skillPath);
    const contents = readFileSync(skillPath, "utf8");

    try {
      const frontmatter = parseFrontmatter(contents, displayPath);
      if (frontmatter.name !== skillName) {
        failures.push(`${displayPath}: frontmatter name must be ${skillName}`);
      }
      if (
        typeof frontmatter.description !== "string" ||
        frontmatter.description.trim().length === 0 ||
        frontmatter.description.length > 1024
      ) {
        failures.push(`${displayPath}: description must contain 1-1024 characters`);
      } else {
        if (!frontmatter.description.startsWith("This skill should be used")) {
          failures.push(`${displayPath}: description must use third-person trigger wording`);
        }
        if (!frontmatter.description.includes("Do not use")) {
          failures.push(`${displayPath}: description must state an adjacent-work boundary`);
        }
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }

    for (const marker of OUTPUT_CONTRACT_MARKERS[skillName] ?? []) {
      if (!contents.includes(marker)) {
        failures.push(`${displayPath}: missing output-contract marker ${marker}`);
      }
    }

    const body = contents.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
    if (/\bfollow (?:every rule in|the rules in|all rules in).*\bshape-[a-z-]+/i.test(body)) {
      failures.push(`${displayPath}: specialised skills must not depend normatively on siblings`);
    }

    for (const legacyCommand of LEGACY_COMMANDS) {
      if (contents.includes(legacyCommand)) {
        failures.push(`${displayPath}: use current CLI syntax instead of \`${legacyCommand}\``);
      }
    }

    validateReferencedResources(repositoryRoot, skillName, skillRoot, failures);

    const metadataPath = join(skillRoot, "agents/openai.yaml");
    const metadataDisplayPath = relative(repositoryRoot, metadataPath);
    if (!existsSync(metadataPath)) {
      failures.push(`${metadataDisplayPath}: missing skill interface metadata`);
      continue;
    }

    const metadata = Bun.YAML.parse(readFileSync(metadataPath, "utf8")) as SkillMetadata;
    if (
      typeof metadata.interface?.display_name !== "string" ||
      typeof metadata.interface?.short_description !== "string" ||
      typeof metadata.interface?.default_prompt !== "string"
    ) {
      failures.push(`${metadataDisplayPath}: incomplete interface metadata`);
    } else if (!metadata.interface.default_prompt.includes(`$${skillName}`)) {
      failures.push(`${metadataDisplayPath}: default_prompt must reference $${skillName}`);
    }

    if (skillName === "shape-index") {
      if (metadata.policy?.allow_implicit_invocation !== false) {
        failures.push(`${metadataDisplayPath}: shape-index must disable implicit invocation`);
      }
    } else if (metadata.policy?.allow_implicit_invocation === false) {
      failures.push(`${metadataDisplayPath}: only shape-index should disable implicit invocation`);
    }
  }

  validateRoutingCases(repositoryRoot, skillsRoot, failures);
  validateBehaviorCases(repositoryRoot, failures);
  validateCurrentCliExamples(repositoryRoot, skillsRoot, failures);

  return failures;
}

if (import.meta.main) {
  const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const failures = validateSkillPackage(repositoryRoot);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`error: ${failure}`);
    }
    process.exit(1);
  }
  console.log(`Validated ${EXPECTED_SKILLS.length} shipped Shape skills.`);
}
