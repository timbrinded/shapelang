import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        // A narrated video shown above the page content; see "Videos" in DESIGN.md.
        video: z
          .object({
            name: z.string(),
            caption: z.string()
          })
          .optional()
      })
    })
  })
};
