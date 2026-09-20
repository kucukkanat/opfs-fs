import { expect, test } from "bun:test"
import { crc32 as nodeCrc32, gunzipSync as nodeGunzip, gzipSync as nodeGzip } from "node:zlib"
import { constants, gunzipSync, gzipSync, installBrowserBuffer } from "../../src/browser-zlib.js"

const bytes = new TextEncoder().encode("browser gzip\n".repeat(1000))

test("browser compression interoperates with zlib at every supported level", () => {
  for (const level of [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    expect(new Uint8Array(nodeGunzip(gzipSync(bytes, { level })))).toEqual(bytes)
    expect(gunzipSync(nodeGzip(bytes, { level }))).toEqual(bytes)
  }
  expect(gunzipSync(gzipSync(new Uint8Array()))).toEqual(new Uint8Array())
  expect(constants.Z_DEFAULT_COMPRESSION).toBe(-1)
})

test("compression and decompression enforce output limits", () => {
  const compressed = gzipSync(bytes)
  expect(() => gunzipSync(compressed, { maxOutputLength: bytes.length - 1 })).toThrow("maxOutputLength")
  expect(gunzipSync(compressed, { maxOutputLength: bytes.length })).toEqual(bytes)
  expect(() => gzipSync(bytes, { maxOutputLength: 1 })).toThrow("maxOutputLength")
  expect(() => gunzipSync(compressed, { maxOutputLength: 0 })).toThrow()
  expect(() => gzipSync(bytes, { level: 10 })).toThrow()
  expect(() => gzipSync(bytes, { level: 1.5 })).toThrow()
  expect(() => gunzipSync(new Uint8Array([1, 2, 3]))).toThrow()
})

test("concatenated gzip members retain their content and share the output limit", () => {
  const compressed = gzipSync(bytes)
  const members = new Uint8Array(compressed.length * 2)
  members.set(compressed)
  members.set(compressed, compressed.length)
  expect(gunzipSync(members)).toEqual(new Uint8Array(nodeGunzip(members)))
  expect(() => gunzipSync(members, { maxOutputLength: bytes.length })).toThrow("maxOutputLength")
})

test("gzip integrity checks reject altered trailers and truncated members", () => {
  const compressed = gzipSync(bytes)
  const corrupted = compressed.slice()
  const checksumIndex = corrupted.length - 8
  corrupted[checksumIndex] = (corrupted[checksumIndex] ?? 0) ^ 1
  expect(() => gunzipSync(corrupted)).toThrow("checksum")
  expect(() => gunzipSync(compressed.subarray(0, compressed.length - 3))).toThrow()
})

test("installing browser Buffer preserves an existing runtime implementation", () => {
  const existing = globalThis.Buffer
  installBrowserBuffer()
  expect(globalThis.Buffer).toBe(existing)
})

const withHeaderChecksum = (compressed: Uint8Array, optionalFields = false): Uint8Array => {
  // FEXTRA, FNAME and FCOMMENT exercise the complete RFC 1952 header before FHCRC.
  const extra = optionalFields
    ? new Uint8Array([3, 0, 1, 2, 3, 110, 97, 109, 101, 0, 110, 111, 116, 101, 0])
    : new Uint8Array()
  const header = new Uint8Array(10 + extra.length)
  header.set(compressed.subarray(0, 10))
  header[3] = optionalFields ? 2 | 4 | 8 | 16 : 2
  header.set(extra, 10)
  const output = new Uint8Array(compressed.length + extra.length + 2)
  output.set(header)
  new DataView(output.buffer).setUint16(header.length, nodeCrc32(header) & 0xffff, true)
  output.set(compressed.subarray(10), header.length + 2)
  return output
}

test("validates optional gzip header checksums and fields against native zlib", () => {
  for (const optionalFields of [false, true]) {
    const compressed = withHeaderChecksum(gzipSync(bytes), optionalFields)
    expect(new Uint8Array(nodeGunzip(compressed))).toEqual(bytes)
    expect(gunzipSync(compressed)).toEqual(bytes)
    const corrupt = compressed.slice()
    corrupt[4] = (corrupt[4] ?? 0) ^ 1
    expect(() => nodeGunzip(corrupt)).toThrow()
    expect(() => gunzipSync(corrupt)).toThrow("header checksum")
  }
})

test("rejects reserved flags and invalid header checksums in every gzip member", () => {
  const first = gzipSync(bytes)
  const reserved = first.slice()
  reserved[3] = 0x20
  const checksum = withHeaderChecksum(first)
  checksum[10] = (checksum[10] ?? 0) ^ 1
  for (const invalid of [reserved, checksum]) {
    for (const prefix of [new Uint8Array(), first]) {
      const input = new Uint8Array(prefix.length + invalid.length)
      input.set(prefix)
      input.set(invalid, prefix.length)
      expect(() => nodeGunzip(input)).toThrow()
      expect(() => gunzipSync(input)).toThrow("header")
    }
  }
  const second = withHeaderChecksum(first, true)
  const valid = new Uint8Array(first.length + second.length)
  valid.set(first)
  valid.set(second, first.length)
  expect(gunzipSync(valid)).toEqual(new Uint8Array(nodeGunzip(valid)))
})

test("rejects truncated optional gzip header fields", () => {
  const extra = new Uint8Array(20)
  extra.set([31, 139, 8, 4])
  extra[10] = 255
  extra[11] = 255
  expect(() => gunzipSync(extra)).toThrow("extra field")
  const name = new Uint8Array(20).fill(65)
  name.set([31, 139, 8, 8])
  expect(() => gunzipSync(name)).toThrow("Unterminated")
  const checksum = new Uint8Array(18)
  checksum.set([31, 139, 8, 2])
  expect(() => gunzipSync(checksum)).toThrow("header checksum")
})
