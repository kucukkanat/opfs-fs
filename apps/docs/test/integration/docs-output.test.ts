import { expect, test } from "bun:test"

test("emits the interactive wterm documentation page", async () => {
  const page = await Bun.file(`${import.meta.dir}/../../dist/wterm/index.html`).text()
  expect(page).toContain("Build a live browser terminal backed by just-bash and opfs-fs.")
  expect(page).toContain("@wterm/react")
})
