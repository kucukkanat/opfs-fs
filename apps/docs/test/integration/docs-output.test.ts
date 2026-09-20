import { expect, test } from "bun:test"

test("emits the interactive wterm documentation page", async () => {
  const page = await Bun.file(`${import.meta.dir}/../../dist/wterm/index.html`).text()
  expect(page).toContain("Build a live browser terminal backed by just-bash and opfs-fs.")
  expect(page).toContain("@wterm/react")
})

test("emits the interactive xterm.js documentation page", async () => {
  const page = await Bun.file(`${import.meta.dir}/../../dist/xterm/index.html`).text()
  expect(page).toContain("Build a durable browser terminal with xterm.js, just-bash, and opfs-fs.")
  expect(page).toContain("@xterm/xterm")
})

test("links each page to its monorepo source", async () => {
  const page = await Bun.file(`${import.meta.dir}/../../dist/xterm/index.html`).text()
  expect(page).toContain("github.com/kucukkanat/opfs-fs/edit/main/apps/docs/docs/xterm.mdx")
})
