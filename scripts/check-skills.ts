import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_SKILLS = [
  "shape-contract-guard",
  "shape-contract-preflight",
  "shape-index",
  "shape-lang",
  "shape-review"
] as const;

const LEGACY_COMMANDS = [
  "shp graph --stats",
  "shp graph --kind",
  "shp graph Gateway",
  "shp graph <Symbol>",
  "shp graph SYMBOL",
  "--allow-draft-unknown"
] as const;

interface SkillFrontmatter {
  name?: unknown;
  description?: unknown;
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

  for (const skillName of actualSkills) {
    const skillPath = join(skillsRoot, skillName, "SKILL.md");
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
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }

    for (const legacyCommand of LEGACY_COMMANDS) {
      if (contents.includes(legacyCommand)) {
        failures.push(`${displayPath}: use current CLI syntax instead of \`${legacyCommand}\``);
      }
    }

    const metadataPath = join(skillsRoot, skillName, "agents/openai.yaml");
    const metadataDisplayPath = relative(repositoryRoot, metadataPath);
    if (!existsSync(metadataPath)) {
      failures.push(`${metadataDisplayPath}: missing skill interface metadata`);
      continue;
    }

    const metadata = Bun.YAML.parse(readFileSync(metadataPath, "utf8")) as {
      interface?: {
        default_prompt?: unknown;
        display_name?: unknown;
        short_description?: unknown;
      };
    };
    if (
      typeof metadata.interface?.display_name !== "string" ||
      typeof metadata.interface?.short_description !== "string" ||
      typeof metadata.interface?.default_prompt !== "string"
    ) {
      failures.push(`${metadataDisplayPath}: incomplete interface metadata`);
    } else if (!metadata.interface.default_prompt.includes(`$${skillName}`)) {
      failures.push(`${metadataDisplayPath}: default_prompt must reference $${skillName}`);
    }
  }

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
