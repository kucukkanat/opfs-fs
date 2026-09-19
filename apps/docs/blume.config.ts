import { defineConfig } from "blume"

export default defineConfig({
  title: "opfs-fs",
  description: "A durable, transactional filesystem for browser OPFS.",
  github: { owner: "kucukkanat", repo: "opfs-fs" },
  content: { root: "docs" },
  theme: { accent: "teal", radius: "md", mode: "system" },
  ai: { llmsTxt: true },
  deployment: {
    output: "static",
    site: "https://kucukkanat.github.io",
    base: "/opfs-fs",
  },
})
