// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import mdx from "@astrojs/mdx";

export default defineConfig({
  site: "https://aolyang.me",
  output: "server",
  adapter: cloudflare({
    imageService: "compile",
  }),
  integrations: [react(), mdx()],
});
