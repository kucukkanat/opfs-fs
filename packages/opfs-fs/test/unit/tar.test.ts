import { expect, test } from "bun:test"
import { OpfsFsError } from "../../src/errors.js"
import { decodeTar, encodeTar } from "../../src/tar.js"

test("round trips regular files and directories through a portable tar archive", () => {
  const archive = encodeTar([
    { path: "src", data: new Uint8Array(), mode: 0o755, mtime: new Date(1_700_000_000_000), type: "directory" },
    {
      path: "src/hello.txt",
      data: new TextEncoder().encode("hello"),
      mode: 0o644,
      mtime: new Date(1_700_000_001_000),
      type: "file",
    },
  ])

  expect(decodeTar(archive)).toEqual([
    { path: "src/", data: new Uint8Array(), mode: 0o755, mtime: new Date(1_700_000_000_000), type: "directory" },
    {
      path: "src/hello.txt",
      data: new TextEncoder().encode("hello"),
      mode: 0o644,
      mtime: new Date(1_700_000_001_000),
      type: "file",
    },
  ])
})

test("rejects tampered headers and overlong symbolic-link targets", () => {
  const archive = encodeTar([
    { path: "note.txt", data: new TextEncoder().encode("hello"), mode: 0o644, mtime: new Date(), type: "file" },
  ])
  archive[0] = 120
  expect(() => decodeTar(archive)).toThrow(OpfsFsError)
  expect(() =>
    encodeTar([
      {
        path: "link",
        data: new Uint8Array(),
        mode: 0o777,
        mtime: new Date(),
        type: "symlink",
        linkTarget: "x".repeat(101),
      },
    ]),
  ).toThrow(OpfsFsError)
})

test("preserves zero modes, hard links, and USTAR path prefixes", () => {
  const path = `${"nested/".repeat(20)}file.txt`
  const entries = [
    { path, data: new TextEncoder().encode("content"), mode: 0, mtime: new Date(0), type: "file" as const },
    {
      path: "alias",
      data: new Uint8Array(),
      mode: 0,
      mtime: new Date(0),
      type: "hardlink" as const,
      linkTarget: "target",
    },
  ]
  expect(decodeTar(encodeTar(entries))).toEqual(entries)
})

test("rejects truncated file bodies and malformed numeric metadata", () => {
  const entry = { path: "file", data: new Uint8Array(513), mode: 0o644, mtime: new Date(0), type: "file" as const }
  expect(() => decodeTar(encodeTar([entry]).slice(0, 1024))).toThrow(OpfsFsError)
  expect(() => encodeTar([{ ...entry, mode: Number.NaN }])).toThrow(OpfsFsError)
  expect(() => encodeTar([{ ...entry, mtime: new Date(Number.NaN) }])).toThrow(OpfsFsError)
  expect(() => encodeTar([{ ...entry, path: "file\0other" }])).toThrow(OpfsFsError)
  expect(() => encodeTar([{ ...entry, type: "directory" }])).toThrow(OpfsFsError)
  const malformed = encodeTar([entry])
  malformed[106] = 56 // Invalid octal digit, with an otherwise valid header checksum.
  malformed.fill(32, 148, 156)
  const sum = malformed.slice(0, 512).reduce((total, byte) => total + byte, 0)
  malformed.set(new TextEncoder().encode(sum.toString(8).padStart(7, "0")), 148)
  malformed[155] = 0
  expect(() => decodeTar(malformed)).toThrow(OpfsFsError)
})
