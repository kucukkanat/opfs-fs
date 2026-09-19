import { posixError } from "./errors.js";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const blockSize = 512;
const writeString = (target, offset, length, value) => {
    const bytes = encoder.encode(value);
    target.set(bytes.slice(0, length), offset);
};
const writeOctal = (target, offset, length, value) => {
    writeString(target, offset, length - 1, value.toString(8).padStart(length - 1, "0"));
};
export const encodeTar = (entries) => {
    const chunks = [];
    let size = blockSize * 2;
    for (const entry of entries)
        size += blockSize + Math.ceil(entry.data.byteLength / blockSize) * blockSize;
    const archive = new Uint8Array(size);
    let offset = 0;
    for (const entry of entries) {
        if (encoder.encode(entry.path).byteLength > 100)
            throw posixError("ENAMETOOLONG", `Tar path is too long: ${entry.path}`);
        const header = archive.subarray(offset, offset + blockSize);
        writeString(header, 0, 100, entry.type === "directory" && !entry.path.endsWith("/") ? `${entry.path}/` : entry.path);
        writeOctal(header, 100, 8, entry.mode);
        writeOctal(header, 108, 8, 0);
        writeOctal(header, 116, 8, 0);
        writeOctal(header, 124, 12, entry.data.byteLength);
        writeOctal(header, 136, 12, Math.floor(entry.mtime.getTime() / 1000));
        header.fill(32, 148, 156);
        header[156] = entry.type === "directory" ? 53 : entry.type === "symlink" ? 50 : 48;
        if (entry.type === "symlink")
            writeString(header, 157, 100, entry.linkTarget ?? "");
        writeString(header, 257, 6, "ustar");
        writeString(header, 263, 2, "00");
        const checksum = header.reduce((total, byte) => total + byte, 0);
        writeOctal(header, 148, 8, checksum);
        offset += blockSize;
        archive.set(entry.data, offset);
        offset += Math.ceil(entry.data.byteLength / blockSize) * blockSize;
    }
    return archive;
};
const readString = (source, offset, length) => decoder.decode(source.subarray(offset, offset + length)).replace(/\0.*$/, "");
const readOctal = (source, offset, length) => Number.parseInt(readString(source, offset, length).trim() || "0", 8);
export const decodeTar = (archive) => {
    const entries = [];
    for (let offset = 0; offset + blockSize <= archive.byteLength;) {
        const header = archive.subarray(offset, offset + blockSize);
        if (header.every((byte) => byte === 0))
            break;
        const path = readString(header, 0, 100);
        const size = readOctal(header, 124, 12);
        const typeByte = header[156];
        if (!path || (typeByte !== 0 && typeByte !== 48 && typeByte !== 50 && typeByte !== 53))
            throw posixError("EINVAL", "Unsupported tar entry.");
        offset += blockSize;
        const dataEnd = offset + size;
        if (dataEnd > archive.byteLength)
            throw posixError("EINVAL", "Truncated tar archive.");
        const type = typeByte === 53 ? "directory" : typeByte === 50 ? "symlink" : "file";
        entries.push({ path, data: archive.slice(offset, dataEnd), mode: readOctal(header, 100, 8) || (type === "directory" ? 0o755 : type === "symlink" ? 0o777 : 0o644), mtime: new Date(readOctal(header, 136, 12) * 1000), type, ...(type === "symlink" ? { linkTarget: readString(header, 157, 100) } : {}) });
        offset += Math.ceil(size / blockSize) * blockSize;
    }
    return entries;
};
//# sourceMappingURL=tar.js.map