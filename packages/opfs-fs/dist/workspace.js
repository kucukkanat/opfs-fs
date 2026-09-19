import { CapabilityError, ConflictError, CorruptWorkspaceError, OpfsFsError, QuotaExceededError, posixError } from "./errors.js";
import { baseName, isChildPath, normalizePath, parentPath } from "./path.js";
import { decodeTar, encodeTar } from "./tar.js";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const packageDirectory = "kucukkanat-opfs-fs";
const stateDirectory = "generations";
const objectDirectory = "objects";
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const clone = (value) => structuredClone(value);
const isQuotaError = (error) => error instanceof DOMException && error.name === "QuotaExceededError";
const asWorkspaceName = (name) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name))
        throw posixError("EINVAL", "Workspace names must contain only letters, numbers, '.', '_' or '-'.");
    return name;
};
const randomId = () => {
    if (!globalThis.crypto?.randomUUID)
        throw new CapabilityError("crypto.randomUUID() is required to create an OPFS workspace.");
    return globalThis.crypto.randomUUID();
};
const digest = async (value) => {
    if (!globalThis.crypto?.subtle)
        throw new CapabilityError("Web Crypto is required to validate OPFS workspace metadata.");
    const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value)));
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary);
};
const encodeContent = (content, encoding) => {
    if (content instanceof Uint8Array)
        return content.slice();
    if (encoding === "binary" || encoding === "latin1")
        return Uint8Array.from(content, (character) => character.charCodeAt(0) & 0xff);
    return encoder.encode(content);
};
const decodeContent = (content, encoding) => {
    if (encoding === "binary" || encoding === "latin1")
        return Array.from(content, (byte) => String.fromCharCode(byte)).join("");
    if (encoding === "ascii")
        return Array.from(content, (byte) => String.fromCharCode(byte & 0x7f)).join("");
    return decoder.decode(content);
};
const encodingFrom = (options) => typeof options === "string" ? options : options?.encoding;
const now = () => Date.now();
const statFor = (inode, node) => ({
    isFile: node.kind === "file",
    isDirectory: node.kind === "directory",
    isSymbolicLink: node.kind === "symlink",
    mode: node.mode,
    size: node.kind === "file" ? node.size : node.kind === "symlink" ? encoder.encode(node.target).byteLength : 0,
    mtime: new Date(node.mtime),
    identity: `opfs:${inode}`,
});
const emptyState = (root) => {
    const state = { schema: 1, generation: 0, nextInode: 2, root: "1", inodes: { "1": { kind: "directory", mode: 0o755, mtime: now(), entries: {} } } };
    const parts = normalizePath(root).split("/").filter(Boolean);
    let parent = "1";
    for (const part of parts) {
        const id = String(state.nextInode++);
        state.inodes[id] = { kind: "directory", mode: 0o755, mtime: now(), entries: {} };
        const directory = state.inodes[parent];
        if (!directory || directory.kind !== "directory")
            throw new CorruptWorkspaceError("Cannot initialize workspace root.");
        directory.entries[part] = id;
        parent = id;
    }
    return state;
};
const assertState = (value) => {
    if (!isRecord(value) || value.schema !== 1 || typeof value.generation !== "number" || typeof value.nextInode !== "number" || typeof value.root !== "string" || !isRecord(value.inodes))
        throw new CorruptWorkspaceError("Invalid OPFS workspace manifest.");
    return value;
};
const manifestText = (state) => JSON.stringify({ schema: 1, state });
const parseManifest = async (text) => {
    let decoded;
    try {
        decoded = JSON.parse(text);
    }
    catch (error) {
        throw new CorruptWorkspaceError("Workspace manifest is not JSON.", { cause: error });
    }
    if (!isRecord(decoded) || decoded.schema !== 1 || typeof decoded.checksum !== "string")
        throw new CorruptWorkspaceError("Workspace manifest has an unknown schema.");
    const state = assertState(decoded.state);
    const expected = await digest(manifestText(state));
    if (expected !== decoded.checksum)
        throw new CorruptWorkspaceError("Workspace manifest checksum does not match.");
    return { schema: 1, state, checksum: decoded.checksum };
};
const getDirectory = async (parent, name) => parent.getDirectoryHandle(name, { create: true });
const writeBytes = async (directory, name, bytes) => {
    try {
        const file = await directory.getFileHandle(name, { create: true });
        const writer = await file.createWritable();
        await writer.write(new Uint8Array(bytes));
        await writer.close();
    }
    catch (error) {
        if (isQuotaError(error))
            throw new QuotaExceededError("The browser does not have enough storage for this workspace change.", { cause: error });
        throw error;
    }
};
const readBytes = async (directory, name) => {
    try {
        const file = await directory.getFileHandle(name);
        return new Uint8Array(await (await file.getFile()).arrayBuffer());
    }
    catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError")
            throw posixError("ENOENT", `Missing OPFS metadata: ${name}`);
        throw error;
    }
};
const writeJson = async (directory, name, value) => writeBytes(directory, name, encoder.encode(JSON.stringify(value)));
const readJson = async (directory, name) => JSON.parse(decoder.decode(await readBytes(directory, name)));
export class OpfsWorkspace {
    name;
    root;
    storage;
    #directory;
    #generations;
    #objects;
    #state;
    #channel;
    #stale = false;
    #closed = false;
    #transaction;
    constructor(name, root, directory, generations, objects, state) {
        this.name = name;
        this.root = root;
        this.#directory = directory;
        this.#generations = generations;
        this.#objects = objects;
        this.#state = state;
        this.storage = {
            estimate: async () => {
                const estimate = await navigator.storage.estimate();
                return { ...(estimate.usage === undefined ? {} : { usage: estimate.usage }), ...(estimate.quota === undefined ? {} : { quota: estimate.quota }) };
            },
            requestPersistence: async () => navigator.storage.persist(),
        };
        if (typeof BroadcastChannel !== "undefined") {
            this.#channel = new BroadcastChannel(`${packageDirectory}:${name}`);
            this.#channel.onmessage = () => { this.#stale = true; };
        }
    }
    static async open(options) {
        if (!navigator.storage?.getDirectory)
            throw new CapabilityError("OPFS is unavailable. Use a secure, supported browser context.");
        if (!navigator.locks?.request)
            throw new CapabilityError("Web Locks are unavailable. OPFS workspaces require Web Locks for safe multi-context writes.");
        const name = asWorkspaceName(options.name);
        const root = normalizePath(options.root ?? "/");
        const opfs = await navigator.storage.getDirectory();
        const base = await getDirectory(opfs, packageDirectory);
        const workspaces = await getDirectory(base, "workspaces");
        const directory = await getDirectory(workspaces, name);
        const generations = await getDirectory(directory, stateDirectory);
        const objects = await getDirectory(directory, objectDirectory);
        const initial = emptyState(root);
        const workspace = new OpfsWorkspace(name, root, directory, generations, objects, initial);
        try {
            await workspace.#loadLatest();
        }
        catch (error) {
            if (!(error instanceof OpfsFsError) || error.code !== "ENOENT")
                throw error;
            await workspace.#commit(initial);
        }
        return workspace;
    }
    #assertOpen() {
        if (this.#closed)
            throw new OpfsFsError("CLOSED", "This OPFS workspace has been closed.");
    }
    #current() {
        this.#assertOpen();
        return this.#transaction ?? this.#state;
    }
    async #loadLatest() {
        try {
            const pointer = await readJson(this.#directory, "current.json");
            if (!isRecord(pointer) || typeof pointer.generation !== "number" || typeof pointer.checksum !== "string")
                throw new CorruptWorkspaceError("Workspace pointer is invalid.");
            const manifest = await parseManifest(decoder.decode(await readBytes(this.#generations, `${pointer.generation}.json`)));
            if (manifest.checksum !== pointer.checksum)
                throw new CorruptWorkspaceError("Workspace pointer does not match its manifest.");
            this.#state = manifest.state;
            this.#stale = false;
            return;
        }
        catch (error) {
            const recovered = await this.#recoverLatest();
            if (!recovered)
                throw error;
            this.#state = recovered.state;
            this.#stale = false;
            await writeJson(this.#directory, "current.json", { generation: recovered.state.generation, checksum: recovered.checksum });
        }
    }
    async #recoverLatest() {
        const candidates = [];
        for await (const [name, handle] of this.#generations) {
            if (handle.kind !== "file" || !/^\d+\.json$/.test(name))
                continue;
            try {
                candidates.push(await parseManifest(decoder.decode(await readBytes(this.#generations, name))));
            }
            catch { /* An incomplete generation is intentionally ignored. */ }
        }
        return candidates.sort((left, right) => right.state.generation - left.state.generation)[0];
    }
    async #refresh() {
        if (!this.#stale)
            return;
        await this.#loadLatest();
    }
    async #commit(state) {
        const next = clone(state);
        next.generation = this.#state.generation + 1;
        const checksum = await digest(manifestText(next));
        const manifest = { schema: 1, state: next, checksum };
        await writeJson(this.#generations, `${next.generation}.json`, manifest);
        await writeJson(this.#directory, "current.json", { generation: next.generation, checksum });
        this.#state = next;
        this.#stale = false;
        this.#channel?.postMessage(next.generation);
    }
    async #exclusive(operation) {
        this.#assertOpen();
        if (this.#transaction)
            return operation();
        return navigator.locks.request(`${packageDirectory}:${this.name}`, { mode: "exclusive" }, async () => {
            await this.#refresh();
            const draft = clone(this.#state);
            this.#transaction = draft;
            try {
                const result = await operation();
                this.#transaction = undefined;
                await this.#commit(draft);
                return result;
            }
            catch (error) {
                this.#transaction = undefined;
                throw error;
            }
        });
    }
    #node(state, inode) {
        const node = state.inodes[inode];
        if (!node)
            throw new CorruptWorkspaceError(`Missing inode ${inode}.`);
        return node;
    }
    #resolve(state, path, followFinal = true, depth = 0) {
        if (depth > 40)
            throw posixError("ELOOP", `Too many symbolic links: ${path}`);
        const normalized = normalizePath(path);
        if (normalized === "/")
            return state.root;
        const parts = normalized.slice(1).split("/");
        let inode = state.root;
        let resolved = "/";
        for (let index = 0; index < parts.length; index += 1) {
            const part = parts[index];
            if (!part)
                continue;
            const directory = this.#node(state, inode);
            if (directory.kind !== "directory")
                throw posixError("ENOTDIR", `Not a directory: ${resolved}`);
            const child = directory.entries[part];
            if (!child)
                throw posixError("ENOENT", `No such file or directory: ${path}`);
            const node = this.#node(state, child);
            const isFinal = index === parts.length - 1;
            if (node.kind === "symlink" && (followFinal || !isFinal)) {
                const target = node.target.startsWith("/") ? node.target : normalizePath(node.target, resolved);
                const remainder = parts.slice(index + 1).join("/");
                return this.#resolve(state, remainder ? `${target}/${remainder}` : target, true, depth + 1);
            }
            inode = child;
            resolved = normalizePath(part, resolved);
        }
        return inode;
    }
    #realpath(state, path, depth = 0) {
        if (depth > 40)
            throw posixError("ELOOP", `Too many symbolic links: ${path}`);
        const normalized = normalizePath(path);
        if (normalized === "/")
            return "/";
        const parts = normalized.slice(1).split("/");
        let inode = state.root;
        let resolved = "/";
        for (let index = 0; index < parts.length; index += 1) {
            const part = parts[index];
            if (!part)
                continue;
            const directory = this.#node(state, inode);
            if (directory.kind !== "directory")
                throw posixError("ENOTDIR", `Not a directory: ${resolved}`);
            const child = directory.entries[part];
            if (!child)
                throw posixError("ENOENT", `No such file or directory: ${path}`);
            const node = this.#node(state, child);
            if (node.kind === "symlink") {
                const target = node.target.startsWith("/") ? node.target : normalizePath(node.target, resolved);
                const remainder = parts.slice(index + 1).join("/");
                return this.#realpath(state, remainder ? `${target}/${remainder}` : target, depth + 1);
            }
            inode = child;
            resolved = normalizePath(part, resolved);
        }
        return resolved;
    }
    #parent(state, path) {
        const normalized = normalizePath(path);
        if (normalized === "/")
            throw posixError("EPERM", "Cannot modify the filesystem root.");
        const parent = parentPath(normalized);
        const inode = this.#resolve(state, parent);
        const directory = this.#node(state, inode);
        if (directory.kind !== "directory")
            throw posixError("ENOTDIR", `Not a directory: ${parent}`);
        return { directory, parent: inode, name: baseName(normalized) };
    }
    #newInode(state, node) {
        const inode = String(state.nextInode++);
        state.inodes[inode] = node;
        return inode;
    }
    async #writeObject(content) {
        const key = `${randomId()}.bin`;
        await writeBytes(this.#objects, key, content);
        return key;
    }
    async #readObject(key) {
        return readBytes(this.#objects, key);
    }
    #removeEntry(state, path, options = {}) {
        const { directory, name } = this.#parent(state, path);
        const inode = directory.entries[name];
        if (!inode) {
            if (options.force)
                return;
            throw posixError("ENOENT", `No such file or directory: ${path}`);
        }
        const node = this.#node(state, inode);
        if (node.kind === "directory" && Object.keys(node.entries).length > 0 && !options.recursive)
            throw posixError("ENOTEMPTY", `Directory not empty: ${path}`);
        if (node.kind === "directory" && options.recursive) {
            for (const child of Object.keys(node.entries))
                this.#removeEntry(state, normalizePath(child, path), { recursive: true });
        }
        delete directory.entries[name];
        if (node.kind === "file") {
            node.links -= 1;
            if (node.links === 0)
                delete state.inodes[inode];
        }
        else
            delete state.inodes[inode];
    }
    async readFileBuffer(path) {
        await this.#refresh();
        const state = this.#current();
        const node = this.#node(state, this.#resolve(state, path));
        if (node.kind !== "file")
            throw posixError(node.kind === "directory" ? "EISDIR" : "EINVAL", `Cannot read ${node.kind}: ${path}`);
        return this.#readObject(node.content);
    }
    async readFileBytes(path) { return decodeContent(await this.readFileBuffer(path), "binary"); }
    async readFile(path, options) { return decodeContent(await this.readFileBuffer(path), encodingFrom(options)); }
    async writeFile(path, content, options) {
        const bytes = encodeContent(content, encodingFrom(options));
        await this.#exclusive(async () => {
            const state = this.#current();
            let inode;
            try {
                inode = this.#resolve(state, path);
            }
            catch (error) {
                if (!(error instanceof OpfsFsError) || error.code !== "ENOENT")
                    throw error;
            }
            const key = await this.#writeObject(bytes);
            if (inode) {
                const node = this.#node(state, inode);
                if (node.kind === "directory")
                    throw posixError("EISDIR", `Cannot write a directory: ${path}`);
                if (node.kind !== "file")
                    throw posixError("EINVAL", `Cannot write ${node.kind}: ${path}`);
                node.content = key;
                node.size = bytes.byteLength;
                node.mtime = now();
                return;
            }
            const { directory, name } = this.#parent(state, path);
            directory.entries[name] = this.#newInode(state, { kind: "file", mode: typeof options === "object" && options !== null ? options.mode ?? 0o644 : 0o644, mtime: now(), content: key, size: bytes.byteLength, links: 1 });
        });
    }
    async appendFile(path, content, options) {
        await this.#exclusive(async () => {
            const state = this.#current();
            const inode = this.#resolve(state, path);
            const node = this.#node(state, inode);
            if (node.kind !== "file")
                throw posixError("EISDIR", `Cannot append to ${path}`);
            const addition = encodeContent(content, encodingFrom(options));
            const existing = await this.#readObject(node.content);
            const merged = new Uint8Array(existing.byteLength + addition.byteLength);
            merged.set(existing);
            merged.set(addition, existing.byteLength);
            node.content = await this.#writeObject(merged);
            node.size = merged.byteLength;
            node.mtime = now();
        });
    }
    async exists(path) {
        try {
            await this.#refresh();
            this.#resolve(this.#current(), path);
            return true;
        }
        catch (error) {
            if (error instanceof OpfsFsError && error.code === "ENOENT")
                return false;
            throw error;
        }
    }
    async stat(path) { await this.#refresh(); const state = this.#current(); const inode = this.#resolve(state, path); return statFor(inode, this.#node(state, inode)); }
    async lstat(path) { await this.#refresh(); const state = this.#current(); const inode = this.#resolve(state, path, false); return statFor(inode, this.#node(state, inode)); }
    async mkdir(path, options = {}) {
        await this.#exclusive(async () => {
            const state = this.#current();
            const normalized = normalizePath(path);
            if (normalized === "/")
                return;
            const parts = normalized.slice(1).split("/");
            let cursor = "/";
            for (const part of parts) {
                cursor = normalizePath(part, cursor);
                try {
                    const existing = this.#node(state, this.#resolve(state, cursor));
                    if (existing.kind !== "directory")
                        throw posixError("ENOTDIR", `Not a directory: ${cursor}`);
                }
                catch (error) {
                    if (!(error instanceof OpfsFsError) || error.code !== "ENOENT")
                        throw error;
                    if (!options.recursive && cursor !== normalized)
                        throw posixError("ENOENT", `No such directory: ${parentPath(cursor)}`);
                    const { directory, name } = this.#parent(state, cursor);
                    directory.entries[name] = this.#newInode(state, { kind: "directory", mode: 0o755, mtime: now(), entries: {} });
                }
            }
        });
    }
    async readdirWithFileTypes(path) {
        await this.#refresh();
        const state = this.#current();
        const node = this.#node(state, this.#resolve(state, path));
        if (node.kind !== "directory")
            throw posixError("ENOTDIR", `Not a directory: ${path}`);
        return Object.entries(node.entries).map(([name, inode]) => {
            const child = this.#node(state, inode);
            return { name, isFile: child.kind === "file", isDirectory: child.kind === "directory", isSymbolicLink: child.kind === "symlink" };
        }).sort((left, right) => left.name.localeCompare(right.name));
    }
    async readdir(path) { return (await this.readdirWithFileTypes(path)).map((entry) => entry.name); }
    async rm(path, options) { await this.#exclusive(async () => this.#removeEntry(this.#current(), path, options)); }
    async cp(source, destination, options = {}) {
        await this.#exclusive(async () => {
            const state = this.#current();
            const copy = async (from, to) => {
                const inode = this.#resolve(state, from, false);
                const node = this.#node(state, inode);
                if (node.kind === "directory") {
                    if (!options.recursive)
                        throw posixError("EISDIR", `Cannot copy directory without recursive: ${from}`);
                    await this.mkdir(to, { recursive: true });
                    for (const name of Object.keys(node.entries))
                        await copy(normalizePath(name, from), normalizePath(name, to));
                    return;
                }
                if (node.kind === "symlink") {
                    await this.symlink(node.target, to);
                    return;
                }
                await this.writeFile(to, await this.#readObject(node.content), { mode: node.mode });
            };
            await copy(source, destination);
        });
    }
    async mv(source, destination) {
        await this.#exclusive(async () => {
            const state = this.#current();
            const sourcePath = normalizePath(source);
            const destinationPath = normalizePath(destination);
            if (sourcePath === destinationPath)
                return;
            const sourceParent = this.#parent(state, sourcePath);
            const inode = sourceParent.directory.entries[sourceParent.name];
            if (!inode)
                throw posixError("ENOENT", `No such file or directory: ${source}`);
            const node = this.#node(state, inode);
            if (node.kind === "directory" && isChildPath(sourcePath, destinationPath))
                throw posixError("EINVAL", `Cannot move ${source} into itself.`);
            const destinationParent = this.#parent(state, destinationPath);
            if (destinationParent.directory.entries[destinationParent.name])
                this.#removeEntry(state, destinationPath, { recursive: true });
            delete sourceParent.directory.entries[sourceParent.name];
            destinationParent.directory.entries[destinationParent.name] = inode;
        });
    }
    resolvePath(base, path) { return normalizePath(path, base); }
    getAllPaths() {
        const state = this.#current();
        const paths = [];
        const walk = (inode, path) => {
            paths.push(path);
            const node = this.#node(state, inode);
            if (node.kind === "directory")
                for (const [name, child] of Object.entries(node.entries))
                    walk(child, normalizePath(name, path));
        };
        walk(state.root, "/");
        return paths.sort();
    }
    async chmod(path, mode) { await this.#exclusive(async () => { const state = this.#current(); this.#node(state, this.#resolve(state, path, false)).mode = mode; }); }
    async symlink(target, path) { await this.#exclusive(async () => { const state = this.#current(); const { directory, name } = this.#parent(state, path); if (directory.entries[name])
        throw posixError("EEXIST", `Path already exists: ${path}`); directory.entries[name] = this.#newInode(state, { kind: "symlink", mode: 0o777, mtime: now(), target }); }); }
    async link(existingPath, path) { await this.#exclusive(async () => { const state = this.#current(); const inode = this.#resolve(state, existingPath); const node = this.#node(state, inode); if (node.kind !== "file")
        throw posixError("EPERM", `Hard links require a regular file: ${existingPath}`); const { directory, name } = this.#parent(state, path); if (directory.entries[name])
        throw posixError("EEXIST", `Path already exists: ${path}`); directory.entries[name] = inode; node.links += 1; }); }
    async readlink(path) { await this.#refresh(); const state = this.#current(); const node = this.#node(state, this.#resolve(state, path, false)); if (node.kind !== "symlink")
        throw posixError("EINVAL", `Not a symbolic link: ${path}`); return node.target; }
    async realpath(path) { await this.#refresh(); return this.#realpath(this.#current(), path); }
    async utimes(path, _atime, mtime) { await this.#exclusive(async () => { const state = this.#current(); this.#node(state, this.#resolve(state, path, false)).mtime = mtime.getTime(); }); }
    async transaction(operation) {
        if (this.#transaction)
            throw new ConflictError("Nested OPFS workspace transactions are not supported.");
        return navigator.locks.request(`${packageDirectory}:${this.name}`, { mode: "exclusive" }, async () => {
            await this.#refresh();
            const draft = clone(this.#state);
            this.#transaction = draft;
            try {
                const result = await operation(this);
                this.#transaction = undefined;
                await this.#commit(draft);
                return result;
            }
            catch (error) {
                this.#transaction = undefined;
                throw error;
            }
        });
    }
    async exportArchive(options) {
        if (options.format !== "tar")
            throw posixError("EINVAL", `Unsupported archive format: ${options.format}`);
        await this.#refresh();
        const state = this.#current();
        const entries = [];
        const walk = async (inode, path) => {
            const node = this.#node(state, inode);
            const relative = path === this.root ? "" : path.slice(this.root.length).replace(/^\//, "");
            if (node.kind === "directory") {
                if (relative)
                    entries.push({ path: relative, data: new Uint8Array(), mode: node.mode, mtime: new Date(node.mtime), type: "directory" });
                for (const [name, child] of Object.entries(node.entries))
                    await walk(child, normalizePath(name, path));
            }
            else if (node.kind === "file")
                entries.push({ path: relative, data: await this.#readObject(node.content), mode: node.mode, mtime: new Date(node.mtime), type: "file" });
            else
                entries.push({ path: relative, data: new Uint8Array(), mode: node.mode, mtime: new Date(node.mtime), type: "symlink", linkTarget: node.target });
        };
        await walk(this.#resolve(state, this.root), this.root);
        return new Blob([new Uint8Array(encodeTar(entries))], { type: "application/x-tar" });
    }
    async importArchive(archive) {
        const bytes = archive instanceof Uint8Array ? archive : new Uint8Array(await archive.arrayBuffer());
        const entries = decodeTar(bytes);
        await this.transaction(async (filesystem) => {
            for (const entry of entries) {
                const path = normalizePath(entry.path, this.root);
                if (entry.type === "directory")
                    await filesystem.mkdir(path, { recursive: true });
                else if (entry.type === "symlink") {
                    await filesystem.mkdir(parentPath(path), { recursive: true });
                    await filesystem.symlink(entry.linkTarget ?? "", path);
                }
                else {
                    await filesystem.mkdir(parentPath(path), { recursive: true });
                    await filesystem.writeFile(path, entry.data, { mode: entry.mode });
                    await filesystem.utimes(path, entry.mtime, entry.mtime);
                }
            }
        });
    }
    async reset() {
        await this.#exclusive(async () => {
            const draft = this.#current();
            const fresh = emptyState(this.root);
            draft.generation = fresh.generation;
            draft.nextInode = fresh.nextInode;
            draft.root = fresh.root;
            draft.inodes = fresh.inodes;
        });
    }
    close() {
        this.#channel?.close();
        this.#closed = true;
    }
}
export const openWorkspace = (options) => OpfsWorkspace.open(options);
//# sourceMappingURL=workspace.js.map