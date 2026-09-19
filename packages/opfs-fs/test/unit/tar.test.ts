import { expect, test } from "bun:test"
import { decodeTar, encodeTar } from "../../src/tar.js"

test("round trips regular files and directories through a portable tar archive", () => {
  const archive = encodeTar([
    { path: "src", data: new Uint8Array(), mode: 0o755, mtime: new Date(1_700_000_000_000), type: "directory" },
    { path: "src/hello.txt", data: new TextEncoder().encode("hello"), mode: 0o644, mtime: new Date(1_700_000_001_000), type: "file" },
  ])

  expect(decodeTar(archive)).toEqual([
    { path: "src/", data: new Uint8Array(), mode: 0o755, mtime: new Date(1_700_000_000_000), type: "directory" },
    { path: "src/hello.txt", data: new TextEncoder().encode("hello"), mode: 0o644, mtime: new Date(1_700_000_001_000), type: "file" },
  ])
})
