import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Hand-written complex articles (MDX, may embed React islands).
const posts = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./content/posts" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    publishedAt: z.coerce.date(),
    commentId: z.string().optional(), // stable thread key; defaults to slug
    draft: z.boolean().optional().default(false),
  }),
});

// Quick notes exported by the web editor (plain TipTap JSON + metadata,
// auto-committed to content/notes/<noteId>.json on publish).
const notes = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./content/notes" }),
  schema: z.object({
    schemaVersion: z.literal(1),
    noteId: z.string(),
    slug: z.string(),
    revision: z.number().int().positive(),
    title: z.string(),
    publishedAt: z.string(),
    document: z.object({ type: z.literal("doc") }).passthrough(),
  }),
});

export const collections = { posts, notes };
