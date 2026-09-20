import { expect, test } from "bun:test"
import { InMemoryFs } from "just-bash/browser"
import { createFxCheckpointStore } from "../../src/fx.js"

test("unclassified filesystem errors and invalid read operations propagate", async () => {
  const filesystem = new InMemoryFs()
  const missing = createFxCheckpointStore(filesystem, "/missing")
  await expect(missing.load()).rejects.toThrow("ENOENT")
  await filesystem.mkdir("/directory")
  await expect(createFxCheckpointStore(filesystem, "/directory").load()).rejects.toThrow()
})

test("checkpoint reads preserve opaque bytes and validate paths", async () => {
  const filesystem = new InMemoryFs()
  const bytes = new Uint8Array([0, 255, 128, 1])
  await filesystem.writeFile("/checkpoint", bytes)
  expect(await createFxCheckpointStore(filesystem, "/unused/../checkpoint").load()).toEqual(bytes)
  expect(() => createFxCheckpointStore(filesystem, "/bad\0path")).toThrow()
  expect(() => createFxCheckpointStore(filesystem, "../outside")).toThrow()
})
