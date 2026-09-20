import { posixError } from "./errors.js"

export type TarEntry = Readonly<{
  path: string
  data: Uint8Array
  mode: number
  mtime: Date
  type: "file" | "directory" | "symlink" | "hardlink"
  linkTarget?: string
}>

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const blockSize = 512

const writeString = (target: Uint8Array, offset: number, length: number, value: string): void => {
  if (value.includes("\0")) throw posixError("EINVAL", "Tar fields cannot contain NUL bytes.")
  const bytes = encoder.encode(value)
  if (bytes.byteLength > length) throw posixError("ENAMETOOLONG", "Tar header field is too long.")
  target.set(bytes.slice(0, length), offset)
}

const writeOctal = (target: Uint8Array, offset: number, length: number, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw posixError("EINVAL", "Tar numeric fields must be nonnegative safe integers.")
  writeString(target, offset, length - 1, value.toString(8).padStart(length - 1, "0"))
}

export const encodeTar = (entries: readonly TarEntry[]): Uint8Array => {
  let size = blockSize * 2
  for (const entry of entries) size += blockSize + Math.ceil(entry.data.byteLength / blockSize) * blockSize
  const archive = new Uint8Array(size)
  let offset = 0
  for (const entry of entries) {
    if (!entry.path || (entry.type !== "file" && entry.data.byteLength !== 0))
      throw posixError("EINVAL", "Tar entries require a path; only regular files may contain data.")
    let name = entry.type === "directory" && !entry.path.endsWith("/") ? `${entry.path}/` : entry.path
    let prefix = ""
    if (encoder.encode(name).byteLength > 100) {
      const split = Array.from(name.matchAll(/\//g))
        .map((match) => match.index)
        .reverse()
        .find(
          (index) =>
            encoder.encode(name.slice(0, index)).byteLength <= 155 &&
            encoder.encode(name.slice(index + 1)).byteLength <= 100,
        )
      if (split === undefined) throw posixError("ENAMETOOLONG", `Tar path is too long: ${entry.path}`)
      prefix = name.slice(0, split)
      name = name.slice(split + 1)
    }
    if (
      (entry.type === "symlink" || entry.type === "hardlink") &&
      encoder.encode(entry.linkTarget ?? "").byteLength > 100
    )
      throw posixError("ENAMETOOLONG", `Tar link target is too long: ${entry.linkTarget}`)
    const header = archive.subarray(offset, offset + blockSize)
    writeString(header, 0, 100, name)
    writeOctal(header, 100, 8, entry.mode)
    writeOctal(header, 108, 8, 0)
    writeOctal(header, 116, 8, 0)
    writeOctal(header, 124, 12, entry.data.byteLength)
    writeOctal(header, 136, 12, Math.floor(entry.mtime.getTime() / 1000))
    header.fill(32, 148, 156)
    header[156] = entry.type === "directory" ? 53 : entry.type === "symlink" ? 50 : entry.type === "hardlink" ? 49 : 48
    if (entry.type === "symlink" || entry.type === "hardlink") writeString(header, 157, 100, entry.linkTarget ?? "")
    writeString(header, 257, 6, "ustar")
    writeString(header, 263, 2, "00")
    writeString(header, 345, 155, prefix)
    const checksum = header.reduce((total, byte) => total + byte, 0)
    writeOctal(header, 148, 8, checksum)
    offset += blockSize
    archive.set(entry.data, offset)
    offset += Math.ceil(entry.data.byteLength / blockSize) * blockSize
  }
  return archive
}

const readString = (source: Uint8Array, offset: number, length: number): string =>
  decoder.decode(source.subarray(offset, offset + length)).replace(/\0.*$/, "")
const readOctal = (source: Uint8Array, offset: number, length: number): number => {
  const digits = readString(source, offset, length).trim() || "0"
  if (!/^[0-7]+$/.test(digits)) throw posixError("EINVAL", "Invalid octal tar field.")
  const value = Number.parseInt(digits, 8)
  if (!Number.isSafeInteger(value)) throw posixError("EINVAL", "Tar numeric field exceeds the safe integer range.")
  return value
}
const checksum = (header: Uint8Array): number =>
  header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0)

export const decodeTar = (archive: Uint8Array): TarEntry[] => {
  if (archive.byteLength % blockSize !== 0) throw posixError("EINVAL", "Tar archive is not block-aligned.")
  const entries: TarEntry[] = []
  for (let offset = 0; offset + blockSize <= archive.byteLength; ) {
    const header = archive.subarray(offset, offset + blockSize)
    if (header.every((byte) => byte === 0)) break
    const prefix = readString(header, 257, 6) === "ustar" ? readString(header, 345, 155) : ""
    const path = `${prefix ? `${prefix}/` : ""}${readString(header, 0, 100)}`
    const size = readOctal(header, 124, 12)
    const typeByte = header[156]
    const mode = readOctal(header, 100, 8)
    const mtime = new Date(readOctal(header, 136, 12) * 1000)
    if (
      !path ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      !Number.isFinite(mtime.getTime()) ||
      ((typeByte === 49 || typeByte === 50 || typeByte === 53) && size !== 0) ||
      readOctal(header, 148, 8) !== checksum(header) ||
      (typeByte !== 0 && typeByte !== 48 && typeByte !== 49 && typeByte !== 50 && typeByte !== 53)
    )
      throw posixError("EINVAL", "Invalid or unsupported tar entry.")
    offset += blockSize
    const dataEnd = offset + size
    const nextOffset = offset + Math.ceil(size / blockSize) * blockSize
    if (dataEnd > archive.byteLength || nextOffset > archive.byteLength)
      throw posixError("EINVAL", "Truncated tar archive.")
    const type = typeByte === 53 ? "directory" : typeByte === 50 ? "symlink" : typeByte === 49 ? "hardlink" : "file"
    entries.push({
      path,
      data: archive.slice(offset, dataEnd),
      mode,
      mtime,
      type,
      ...(type === "symlink" || type === "hardlink" ? { linkTarget: readString(header, 157, 100) } : {}),
    })
    offset = nextOffset
  }
  return entries
}
