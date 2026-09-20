import { Buffer } from "buffer/"
import { Gunzip, Gzip } from "fflate"

/** Explicit opt-in for just-bash commands that reference the browser Buffer global. */
export const installBrowserBuffer = (): void => {
  if (!("Buffer" in globalThis))
    Object.defineProperty(globalThis, "Buffer", { value: Buffer, writable: true, configurable: true })
}

/** The synchronous node:zlib subset imported by just-bash's browser entry point. */
export const constants = Object.freeze({ Z_BEST_COMPRESSION: 9, Z_BEST_SPEED: 1, Z_DEFAULT_COMPRESSION: -1 })
export type ZlibOptions = Readonly<{ level?: number; maxOutputLength?: number }>

const collect = (
  input: Uint8Array,
  options: ZlibOptions,
  create: (ondata: (chunk: Uint8Array) => void) => Readonly<{ push: (chunk: Uint8Array, final: boolean) => void }>,
): Uint8Array => {
  const limit = options.maxOutputLength ?? 64 * 1024 * 1024
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("maxOutputLength must be a positive safe integer")
  const chunks: Uint8Array[] = []
  let size = 0
  const stream = create((chunk) => {
    if (chunk.length > limit - size) throw new RangeError(`Compression output exceeds maxOutputLength (${limit} bytes)`)
    size += chunk.length
    chunks.push(chunk)
  })
  // Small compressed-input chunks bound temporary expansion before the output cap is checked.
  const chunkSize = 256
  for (let offset = 0; offset < input.length; offset += chunkSize) {
    const end = Math.min(input.length, offset + chunkSize)
    stream.push(input.subarray(offset, end), end === input.length)
  }
  if (input.length === 0) stream.push(input, true)
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

export const gzipSync = (input: Uint8Array, options: ZlibOptions = {}): Uint8Array => {
  const level = options.level === undefined || options.level === -1 ? 6 : options.level
  const compression = ([0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const).find((candidate) => candidate === level)
  if (compression === undefined) throw new RangeError("Compression level must be an integer between -1 and 9")
  return collect(input, options, (ondata) => new Gzip({ level: compression, mtime: 0 }, ondata))
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  return crc >>> 0
})

const validateHeader = (input: Uint8Array, start: number): void => {
  if (input.length - start < 18 || input[start] !== 31 || input[start + 1] !== 139 || input[start + 2] !== 8)
    throw new Error("Invalid or truncated gzip header")
  const flags = input[start + 3] ?? 0
  if (flags & 0xe0) throw new Error("Invalid gzip header flags")
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const end = input.length - 8
  let cursor = start + 10
  if (flags & 4) {
    if (cursor + 2 > end) throw new Error("Truncated gzip extra field")
    const length = view.getUint16(cursor, true)
    cursor += 2 + length
    if (cursor > end) throw new Error("Truncated gzip extra field")
  }
  for (const flag of [8, 16]) {
    if (!(flags & flag)) continue
    const terminator = input.indexOf(0, cursor)
    if (terminator < 0 || terminator >= end) throw new Error("Unterminated gzip header field")
    cursor = terminator + 1
  }
  if (flags & 2) {
    if (cursor + 2 > end) throw new Error("Truncated gzip header checksum")
    let crc = 0xffffffff
    for (const byte of input.subarray(start, cursor)) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
    if (view.getUint16(cursor, true) !== ((crc ^ 0xffffffff) & 0xffff)) throw new Error("Invalid gzip header checksum")
  }
}

export const gunzipSync = (input: Uint8Array, options: ZlibOptions = {}): Uint8Array => {
  validateHeader(input, 0)
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  let crc = 0xffffffff
  let size = 0
  const validate = (end: number): void => {
    if (
      end < 8 ||
      view.getUint32(end - 8, true) !== (crc ^ 0xffffffff) >>> 0 ||
      view.getUint32(end - 4, true) !== size >>> 0
    )
      throw new Error("Invalid gzip checksum or size")
    crc = 0xffffffff
    size = 0
  }
  const result = collect(input, options, (ondata) => {
    const stream = new Gunzip((chunk) => {
      for (const byte of chunk) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
      size += chunk.length
      ondata(chunk)
    })
    // fflate skips header/trailer checksums; validate each member at its reported boundary.
    stream.onmember = (offset) => {
      validate(offset)
      validateHeader(input, offset)
    }
    return stream
  })
  validate(input.length)
  return result
}
