import { defineConfig, passthroughImageService } from "astro/config";
import starlight from "@astrojs/starlight";
import { shapeLanguage } from "./src/syntax/shape-language.mjs";

const base = "/shapelang";
const repo = "https://github.com/timbrinded/shapelang";

// Old page URLs that were merged into other pages. Astro applies `base` to
// redirect sources but not to destinations, so internal targets include it.
const redirects = {
  "/learn/what-is-shape": `${base}/`,
  "/learn/first-shape-file": `${base}/learn/quickstart/`,
  "/learn/append-only-walkthrough": `${base}/learn/quickstart/`,
  "/learn/global-model-updates": `${base}/guides/keep-model-current/`,
  "/learn/ci-workflow": `${base}/guides/ci/`,
  "/concepts/resources-traits-effects": `${base}/concepts/effect-model/`,
  "/concepts/components-ownership-grants": `${base}/concepts/effect-model/`,
  "/concepts/evidence-source-refs": `${base}/concepts/effect-model/`,
  "/concepts/unknowns-safety": `${base}/concepts/effect-model/`,
  "/concepts/model-updates-attestations": `${base}/guides/keep-model-current/`,
  "/concepts/implementations-coverage": `${base}/guides/keep-model-current/`,
  "/concepts/relations-hypergraphs": `${base}/concepts/relations/`,
  "/concepts/rules-hypercycles": `${base}/concepts/relations/`,
  "/concepts/refactor-constraints": `${base}/concepts/design-memory/`,
  "/concepts/analyzer-hints": `${base}/guides/analyzer/`,
  "/concepts/domain-packs": `${base}/guides/domain-packs/`,
  "/concepts/ast-generation": `${base}/guides/ast-drafts/`,
  "/concepts/diagnostics-provenance": `${base}/reference/diagnostics/#reading-a-diagnostic`,
  "/examples/append-only-pass": `${base}/learn/quickstart/`,
  "/examples/append-only-hard-delete-failure": `${base}/learn/quickstart/`,
  "/examples/global-model-update": `${base}/learn/quickstart/`,
  "/examples/missing-shape-update": `${base}/guides/keep-model-current/`,
  "/examples/refactor-sensitive-function": `${base}/concepts/design-memory/`,
  "/examples/guarded-change-reevaluation": `${base}/concepts/design-memory/`,
  "/examples/forbid-provides-boundary": `${base}/concepts/relations/`,
  "/examples/analyzer-warning": `${base}/guides/analyzer/`,
  "/reference/local-development": `${repo}/blob/master/CONTRIBUTING.md`,
  "/reference/releasing": `${repo}/blob/master/RELEASING.md`,
  "/inside-shape/rule-engine-strategy": `${base}/inside-shape/rule-evaluation/`,
  "/inside-shape/experimental-semantic-kernel": `${repo}/tree/master/experiments/semantic-kernel`
};

export default defineConfig({
  site: "https://timbrinded.github.io",
  base,
  output: "static",
  trailingSlash: "always",
  redirects,
  image: {
    service: passthroughImageService()
  },
  markdown: {
    shikiConfig: {
      langs: [shapeLanguage]
    }
  },
  integrations: [
    starlight({
      title: "Shape",
      description: "A typed architecture conformance language for reviewable system claims.",
      favicon: "/favicon.svg",
      customCss: ["./src/styles/custom.css"],
      editLink: {
        baseUrl: `${repo}/edit/master/docs-site/`
      },
      social: [{ icon: "github", label: "GitHub", href: repo }],
      expressiveCode: {
        shiki: {
          langs: [shapeLanguage]
        }
      },
      components: {
        Hero: "./src/components/Hero.astro"
      },
      sidebar: [
        {
          label: "Start",
          items: [
            { label: "Home", link: "/" },
            { label: "Quickstart", slug: "learn/quickstart" }
          ]
        },
        {
          label: "Guides",
          items: [
            { label: "Keep the Model Current", slug: "guides/keep-model-current" },
            { label: "Run Shape in CI", slug: "guides/ci" },
            { label: "Author Updates with an Agent", slug: "guides/authoring" },
            { label: "Generate Drafts from Source", slug: "guides/ast-drafts" },
            { label: "Analyzer Hints", slug: "guides/analyzer" },
            { label: "Domain Packs", slug: "guides/domain-packs" }
          ]
        },
        {
          label: "Concepts",
          items: [
            { label: "Effect Model", slug: "concepts/effect-model" },
            { label: "Relations and Graph Rules", slug: "concepts/relations" },
            { label: "Design Memory", slug: "concepts/design-memory" }
          ]
        },
        {
          label: "Reference",
          items: [
            { label: "Language Syntax", slug: "reference/language-syntax" },
            { label: "CLI Reference", slug: "reference/cli" },
            { label: "Diagnostics", slug: "reference/diagnostics" },
            { label: "Glossary", slug: "reference/glossary" }
          ]
        },
        {
          label: "Inside Shape",
          items: [
            { label: "Design Rationale", slug: "inside-shape/design-rationale" },
            { label: "Checker Pipeline", slug: "inside-shape/checker-pipeline" },
            { label: "Fact Lowering", slug: "inside-shape/fact-lowering" },
            { label: "Rule Evaluation", slug: "inside-shape/rule-evaluation" },
            { label: "Langium Grammar", slug: "inside-shape/langium-grammar" },
            { label: "Helper APIs", slug: "inside-shape/formatter-editor-authoring" },
            { label: "Contributing", link: `${repo}/blob/master/CONTRIBUTING.md` },
            { label: "Releasing", link: `${repo}/blob/master/RELEASING.md` }
          ]
        }
      ]
    })
  ]
});
