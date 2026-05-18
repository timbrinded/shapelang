import { defineConfig, passthroughImageService } from "astro/config";
import starlight from "@astrojs/starlight";
import { shapeLanguage } from "./src/syntax/shape-language.mjs";

const base = "/shapelang";

export default defineConfig({
  site: "https://timbrinded.github.io",
  base,
  output: "static",
  trailingSlash: "always",
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
        baseUrl: "https://github.com/timbrinded/shapelang/edit/master/docs-site/"
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/timbrinded/shapelang"
        }
      ],
      expressiveCode: {
        shiki: {
          langs: [shapeLanguage]
        }
      },
      sidebar: [
        {
          label: "Start",
          items: [
            { label: "Home", link: "/" },
            { label: "What Shape Is", slug: "learn/what-is-shape" },
            { label: "Quickstart", slug: "learn/quickstart" },
            { label: "First Shape File", slug: "learn/first-shape-file" }
          ]
        },
        {
          label: "Learn",
          items: [
            { label: "Append-Only Walkthrough", slug: "learn/append-only-walkthrough" },
            { label: "PR Change Files", slug: "learn/pr-change-files" },
            { label: "CI Workflow", slug: "learn/ci-workflow" }
          ]
        },
        {
          label: "Concepts",
          items: [{ autogenerate: { directory: "concepts" } }]
        },
        {
          label: "Examples",
          items: [{ autogenerate: { directory: "examples" } }]
        },
        {
          label: "Reference",
          items: [{ autogenerate: { directory: "reference" } }]
        },
        {
          label: "Inside Shape",
          items: [{ autogenerate: { directory: "inside-shape" } }]
        }
      ]
    })
  ]
});
