var _a;
import { CapabilityError, ConflictError, CorruptWorkspaceError, OpfsFsError, posixError, QuotaExceededError, } from "./errors.js";
import { baseName, normalizePath, parentPath } from "./path.js";
import { decodeTar, encodeTar } from "./tar.js";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const packageDirectory = "kucukkanat-opfs-fs";
const stateDirectory = "generations";
const objectDirectory = "objects";
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const clone = (value) => structuredClone(value);
const entry = (entries, name) => Object.hasOwn(entries, name) ? entries[name] : undefined;
const setEntry = (entries, name, inode) => {
    Object.defineProperty(entries, name, { value: inode, enumerable: true, configurable: true, writable: true });
};
const isQuotaError = (error) => error instanceof DOMException && error.name === "QuotaExceededError";
const asWorkspaceName = (name) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name))
        throw posixError("EINVAL", "Workspace names must contain only letters, numbers, '.', '_' or '-'.");
    return name;
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
const contentKey = async (content) => {
    if (!globalThis.crypto?.subtle)
        throw new CapabilityError("Web Crypto is required to validate OPFS file content.");
    const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(content).buffer));
    return `${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}.bin`;
};
const bytesFromBinary = (value) => Uint8Array.from(value, (character) => character.charCodeAt(0));
const bytesFromHex = (value) => {
    if (!/^(?:[\da-fA-F]{2})*$/.test(value))
        throw posixError("EINVAL", "Hex file content must contain complete byte pairs.");
    return Uint8Array.from({ length: value.length / 2 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
};
const binaryFromBytes = (content) => Array.from(content, (byte) => String.fromCharCode(byte)).join("");
const encodeContent = (content, encoding) => {
    if (content instanceof Uint8Array)
        return content.slice();
    if (encoding === "binary" || encoding === "latin1" || encoding === "ascii")
        return Uint8Array.from(content, (character) => character.charCodeAt(0) & 0xff);
    if (encoding === "base64") {
        try {
            return bytesFromBinary(atob(content));
        }
        catch (error) {
            throw posixError("EINVAL", `Invalid base64 file content: ${error instanceof Error ? error.message : "unknown error"}`);
        }
    }
    if (encoding === "hex")
        return bytesFromHex(content);
    return encoder.encode(content);
};
const decodeContent = (content, encoding) => {
    if (encoding === "binary" || encoding === "latin1")
        return Array.from(content, (byte) => String.fromCharCode(byte)).join("");
    if (encoding === "base64")
        return btoa(binaryFromBytes(content));
    if (encoding === "hex")
        return Array.from(content, (byte) => byte.toString(16).padStart(2, "0")).join("");
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
    const state = {
        schema: 1,
        generation: 0,
        nextInode: 2,
        root: "1",
        inodes: {
            "1": { kind: "directory", mode: 0o755, mtime: now(), entries: Object.create(null) },
        },
    };
    const parts = normalizePath(root).split("/").filter(Boolean);
    let parent = "1";
    for (const part of parts) {
        const id = String(state.nextInode++);
        state.inodes[id] = {
            kind: "directory",
            mode: 0o755,
            mtime: now(),
            entries: Object.create(null),
        };
        const directory = state.inodes[parent];
        if (directory?.kind !== "directory")
            throw new CorruptWorkspaceError("Cannot initialize workspace root.");
        setEntry(directory.entries, part, id);
        parent = id;
    }
    return state;
};
const assertState = (value) => {
    if (!isRecord(value) ||
        value.schema !== 1 ||
        typeof value.generation !== "number" ||
        typeof value.nextInode !== "number" ||
        typeof value.root !== "string" ||
        !isRecord(value.inodes))
        throw new CorruptWorkspaceError("Invalid OPFS workspace manifest.");
    if (!Number.isSafeInteger(value.generation) ||
        value.generation < 0 ||
        !Number.isSafeInteger(value.nextInode) ||
        value.nextInode < 2)
        throw new CorruptWorkspaceError("OPFS workspace manifest has invalid inode metadata.");
    for (const [inode, node] of Object.entries(value.inodes)) {
        if (!isRecord(node) ||
            typeof node.kind !== "string" ||
            typeof node.mode !== "number" ||
            typeof node.mtime !== "number")
            throw new CorruptWorkspaceError(`Invalid inode ${inode}.`);
        if (node.kind === "directory") {
            if (!isRecord(node.entries) || Object.values(node.entries).some((child) => typeof child !== "string"))
                throw new CorruptWorkspaceError(`Invalid directory inode ${inode}.`);
        }
        else if (node.kind === "file") {
            if (typeof node.content !== "string" ||
                typeof node.size !== "number" ||
                typeof node.links !== "number" ||
                node.links < 1)
                throw new CorruptWorkspaceError(`Invalid file inode ${inode}.`);
        }
        else if (node.kind !== "symlink" || typeof node.target !== "string")
            throw new CorruptWorkspaceError(`Invalid inode ${inode}.`);
    }
    const state = value;
    if (state.inodes[state.root]?.kind !== "directory")
        throw new CorruptWorkspaceError("OPFS workspace root is invalid.");
    for (const node of Object.values(state.inodes)) {
        if (node.kind === "directory" && Object.values(node.entries).some((inode) => !state.inodes[inode]))
            throw new CorruptWorkspaceError("OPFS workspace references a missing inode.");
    }
    return state;
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
            throw new QuotaExceededError("The browser does not have enough storage for this workspace change.", {
                cause: error,
            });
        throw posixError("EIO", `Cannot write OPFS object: ${name}`, { cause: error, operation: "write", path: name });
    }
};
const readBytes = async (directory, name) => {
    try {
        const file = await directory.getFileHandle(name);
        return new Uint8Array(await (await file.getFile()).arrayBuffer());
    }
    catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError")
            throw posixError("ENOENT", `Missing OPFS object: ${name}`, { cause: error, operation: "read", path: name });
        throw posixError("EIO", `Cannot read OPFS object: ${name}`, { cause: error, operation: "read", path: name });
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
    #listeners = new Set();
    #onDiagnostic;
    #closed = false;
    #transaction;
    #purgeHistory = false;
    constructor(name, root, directory, generations, objects, state, scoped = false, onDiagnostic) {
        this.name = name;
        this.root = root;
        this.#directory = directory;
        this.#generations = generations;
        this.#objects = objects;
        this.#state = state;
        this.#onDiagnostic = onDiagnostic;
        this.storage = {
            estimate: async () => {
                const estimate = await navigator.storage.estimate();
                return {
                    ...(estimate.usage === undefined ? {} : { usage: estimate.usage }),
                    ...(estimate.quota === undefined ? {} : { quota: estimate.quota }),
                };
            },
            requestPersistence: async () => navigator.storage.persist(),
        };
        if (!scoped && typeof BroadcastChannel !== "undefined") {
            this.#channel = new BroadcastChannel(`${packageDirectory}:${name}`);
            this.#channel.onmessage = () => {
                void this.#refresh().catch((error) => {
                    if (!this.#closed)
                        this.#diagnose("refresh-error", error);
                });
            };
        }
    }
    static async open(options) {
        if (typeof navigator === "undefined" || !navigator.storage?.getDirectory)
            throw new CapabilityError("OPFS is unavailable. Use a secure, supported browser context.");
        if (!navigator.locks?.request)
            throw new CapabilityError("Web Locks are unavailable. OPFS workspaces require Web Locks for safe multi-context writes.");
        const name = asWorkspaceName(options.name);
        const root = normalizePath(options.root ?? "/");
        let opfs;
        try {
            opfs = await navigator.storage.getDirectory();
        }
        catch (error) {
            throw new CapabilityError("The browser denied access to OPFS storage.", { cause: error });
        }
        const base = await getDirectory(opfs, packageDirectory);
        const workspaces = await getDirectory(base, "workspaces");
        const directory = await getDirectory(workspaces, name);
        const generations = await getDirectory(directory, stateDirectory);
        const objects = await getDirectory(directory, objectDirectory);
        const initial = emptyState(root);
        const workspace = new _a(name, root, directory, generations, objects, initial, false, options.onDiagnostic);
        try {
            await navigator.locks.request(`${packageDirectory}:${name}`, { mode: "exclusive" }, async () => {
                try {
                    await workspace.#loadLatest(true);
                }
                catch (error) {
                    if (!(error instanceof OpfsFsError) || error.code !== "ENOENT")
                        throw error;
                    // ENOENT can mean a broken commit pointer, not just a workspace's first open.
                    let hasStoredData = false;
                    for await (const [entry] of directory)
                        if (entry === "current.json")
                            hasStoredData = true;
                    for await (const _entry of generations)
                        hasStoredData = true;
                    for await (const _entry of objects)
                        hasStoredData = true;
                    if (hasStoredData)
                        throw new CorruptWorkspaceError("Workspace metadata is missing and no valid generation can be recovered.", {
                            cause: error,
                        });
                    await workspace.#commit(initial);
                }
                const rootNode = workspace.#node(workspace.#state, workspace.#resolve(workspace.#state, root));
                if (rootNode.kind !== "directory")
                    throw posixError("ENOTDIR", `Workspace root is not a directory: ${root}`, {
                        operation: "open",
                        path: root,
                        workspace: name,
                    });
            });
        }
        catch (error) {
            workspace.close();
            throw error;
        }
        return workspace;
    }
    #diagnose(type, error) {
        const event = { type, workspace: this.name, generation: this.#state.generation, error };
        try {
            if (this.#onDiagnostic)
                this.#onDiagnostic(event);
            else
                console.error(`OPFS workspace ${type}`, event);
        }
        catch (diagnosticError) {
            console.error("OPFS diagnostic callback failed", diagnosticError);
        }
    }
    #notify() {
        for (const listener of this.#listeners) {
            try {
                listener();
            }
            catch (error) {
                console.error("OPFS workspace subscriber failed", error);
            }
        }
    }
    subscribe(listener) {
        this.#assertOpen();
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }
    getSnapshot() {
        this.#assertOpen();
        return this.#state.generation;
    }
    #assertOpen() {
        if (this.#closed)
            throw new OpfsFsError("CLOSED", "This OPFS workspace has been closed.");
    }
    #current() {
        this.#assertOpen();
        return this.#transaction ?? this.#state;
    }
    async #loadLatest(repairPointer = false) {
        try {
            const pointer = await readJson(this.#directory, "current.json");
            if (!isRecord(pointer) || typeof pointer.generation !== "number" || typeof pointer.checksum !== "string")
                throw new CorruptWorkspaceError("Workspace pointer is invalid.");
            const manifest = await parseManifest(decoder.decode(await readBytes(this.#generations, `${pointer.generation}.json`)));
            if (manifest.checksum !== pointer.checksum)
                throw new CorruptWorkspaceError("Workspace pointer does not match its manifest.");
            const changed = this.#state.generation !== manifest.state.generation;
            this.#state = manifest.state;
            if (changed)
                this.#notify();
            return;
        }
        catch (error) {
            const recovered = await this.#recoverLatest();
            if (!recovered)
                throw error;
            this.#state = recovered.state;
            this.#diagnose("recovery", error);
            this.#notify();
            if (repairPointer)
                await writeJson(this.#directory, "current.json", {
                    generation: recovered.state.generation,
                    checksum: recovered.checksum,
                });
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
            catch {
                /* An incomplete generation is intentionally ignored. */
            }
        }
        return candidates.sort((left, right) => right.state.generation - left.state.generation)[0];
    }
    async #refresh() {
        this.#assertOpen();
        if (this.#transaction)
            return;
        await navigator.locks.request(`${packageDirectory}:${this.name}`, { mode: "shared" }, async () => this.#loadLatest());
    }
    async #read(operation) {
        this.#assertOpen();
        if (this.#transaction)
            return operation();
        return navigator.locks.request(`${packageDirectory}:${this.name}`, { mode: "shared" }, async () => {
            this.#assertOpen();
            await this.#loadLatest();
            return operation();
        });
    }
    async #commit(state, purgeHistory = false) {
        const previous = this.#state;
        const next = clone(state);
        next.generation = this.#state.generation + 1;
        const checksum = await digest(manifestText(next));
        const manifest = { schema: 1, state: next, checksum };
        await writeJson(this.#generations, `${next.generation}.json`, manifest);
        await writeJson(this.#directory, "current.json", { generation: next.generation, checksum });
        this.#state = next;
        this.#notify();
        try {
            this.#channel?.postMessage(next.generation);
        }
        catch (error) {
            this.#diagnose("refresh-error", error);
        }
        // Publication is the commit point: a maintenance failure must not invite a retry.
        try {
            await this.#collectGarbage(purgeHistory || previous.generation === 0 ? [next] : [next, previous]);
        }
        catch (error) {
            this.#diagnose("cleanup-error", error);
        }
    }
    async #collectGarbage(states) {
        const retained = new Set(states.map((state) => `${state.generation}.json`));
        const objects = new Set(states.flatMap((state) => Object.values(state.inodes).flatMap((node) => (node.kind === "file" ? [node.content] : []))));
        const generationNames = [];
        const objectNames = [];
        for await (const [name] of this.#generations)
            generationNames.push(name);
        for await (const [name] of this.#objects)
            objectNames.push(name);
        for (const name of generationNames)
            if (!retained.has(name))
                await this.#generations.removeEntry(name);
        for (const name of objectNames)
            if (!objects.has(name))
                await this.#objects.removeEntry(name);
    }
    async #exclusive(operation) {
        this.#assertOpen();
        if (this.#transaction)
            return operation(this);
        return navigator.locks.request(`${packageDirectory}:${this.name}`, { mode: "exclusive" }, async () => {
            this.#assertOpen();
            await this.#loadLatest(true);
            const draft = clone(this.#state);
            const scope = new _a(this.name, this.root, this.#directory, this.#generations, this.#objects, draft, true, this.#onDiagnostic);
            scope.#transaction = draft;
            try {
                const result = await operation(scope);
                scope.close();
                await this.#commit(draft, scope.#purgeHistory);
                return result;
            }
            finally {
                scope.close();
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
            const child = entry(directory.entries, part);
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
    #realpath(state, path, depth = 0, allowMissingFinal = false) {
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
            const child = entry(directory.entries, part);
            if (!child && allowMissingFinal && index === parts.length - 1)
                return normalizePath(part, resolved);
            if (!child)
                throw posixError("ENOENT", `No such file or directory: ${path}`);
            const node = this.#node(state, child);
            if (node.kind === "symlink") {
                const target = node.target.startsWith("/") ? node.target : normalizePath(node.target, resolved);
                const remainder = parts.slice(index + 1).join("/");
                return this.#realpath(state, remainder ? `${target}/${remainder}` : target, depth + 1, allowMissingFinal);
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
        return { directory, name: baseName(normalized) };
    }
    #newInode(state, node) {
        const inode = String(state.nextInode++);
        state.inodes[inode] = node;
        return inode;
    }
    async #writeObject(content) {
        const key = await contentKey(content);
        await writeBytes(this.#objects, key, content);
        return key;
    }
    async #readObject(key) {
        const content = await readBytes(this.#objects, key);
        if (/^[\da-f]{64}\.bin$/.test(key) && key !== (await contentKey(content)))
            throw new CorruptWorkspaceError(`OPFS object checksum does not match: ${key}`);
        return content;
    }
    #removeEntry(state, path, options = {}) {
        const { directory, name } = this.#parent(state, path);
        const inode = entry(directory.entries, name);
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
    #assertNoSymlinkPath(state, path) {
        let inode = state.root;
        for (const part of normalizePath(path).split("/").filter(Boolean)) {
            const node = this.#node(state, inode);
            if (node.kind !== "directory")
                return;
            const child = entry(node.entries, part);
            if (!child)
                return;
            const childNode = this.#node(state, child);
            if (childNode.kind === "symlink")
                throw posixError("EINVAL", `Archive entry traverses symbolic link: ${path}`);
            inode = child;
        }
    }
    async readFileBuffer(path) {
        return this.#read(async () => {
            const state = this.#current();
            const node = this.#node(state, this.#resolve(state, path));
            if (node.kind !== "file")
                throw posixError(node.kind === "directory" ? "EISDIR" : "EINVAL", `Cannot read ${node.kind}: ${path}`);
            return this.#readObject(node.content);
        });
    }
    async readBytes(path) {
        return this.readFileBuffer(path);
    }
    async readText(path) {
        return this.readFile(path);
    }
    async readFileBytes(path) {
        return decodeContent(await this.readFileBuffer(path), "binary");
    }
    async readFile(path, options) {
        return decodeContent(await this.readFileBuffer(path), encodingFrom(options));
    }
    async writeFile(path, content, options) {
        const bytes = encodeContent(content, encodingFrom(options));
        await this.#exclusive(async (scope) => {
            const state = scope.#current();
            const target = scope.#realpath(state, path, 0, true);
            let inode;
            try {
                inode = scope.#resolve(state, target);
            }
            catch (error) {
                if (!(error instanceof OpfsFsError) || error.code !== "ENOENT")
                    throw error;
            }
            if (inode) {
                const node = scope.#node(state, inode);
                if (node.kind === "directory")
                    throw posixError("EISDIR", `Cannot write a directory: ${path}`);
                if (node.kind !== "file")
                    throw posixError("EINVAL", `Cannot write ${node.kind}: ${path}`);
                const key = await scope.#writeObject(bytes);
                node.content = key;
                node.size = bytes.byteLength;
                node.mtime = now();
                return;
            }
            const { directory, name } = scope.#parent(state, target);
            const key = await scope.#writeObject(bytes);
            setEntry(directory.entries, name, scope.#newInode(state, {
                kind: "file",
                mode: typeof options === "object" && options !== null ? (options.mode ?? 0o644) : 0o644,
                mtime: now(),
                content: key,
                size: bytes.byteLength,
                links: 1,
            }));
        });
    }
    async appendFile(path, content, options) {
        await this.#exclusive(async (scope) => {
            const state = scope.#current();
            let inode;
            try {
                inode = scope.#resolve(state, path);
            }
            catch (error) {
                if (!(error instanceof OpfsFsError) || error.code !== "ENOENT")
                    throw error;
                await scope.writeFile(path, content, options);
                return;
            }
            const node = scope.#node(state, inode);
            if (node.kind !== "file")
                throw posixError("EISDIR", `Cannot append to ${path}`);
            const addition = encodeContent(content, encodingFrom(options));
            const existing = await scope.#readObject(node.content);
            const merged = new Uint8Array(existing.byteLength + addition.byteLength);
            merged.set(existing);
            merged.set(addition, existing.byteLength);
            node.content = await scope.#writeObject(merged);
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
    async stat(path) {
        await this.#refresh();
        const state = this.#current();
        const inode = this.#resolve(state, path);
        return statFor(inode, this.#node(state, inode));
    }
    async lstat(path) {
        await this.#refresh();
        const state = this.#current();
        const inode = this.#resolve(state, path, false);
        return statFor(inode, this.#node(state, inode));
    }
    async mkdir(path, options = {}) {
        await this.#exclusive(async (scope) => {
            const state = scope.#current();
            const normalized = normalizePath(path);
            if (normalized === "/")
                return;
            const parts = normalized.slice(1).split("/");
            let cursor = "/";
            for (const part of parts) {
                cursor = normalizePath(part, cursor);
                try {
                    const existing = scope.#node(state, scope.#resolve(state, cursor));
                    if (existing.kind !== "directory")
                        throw posixError("ENOTDIR", `Not a directory: ${cursor}`);
                }
                catch (error) {
                    if (!(error instanceof OpfsFsError) || error.code !== "ENOENT")
                        throw error;
                    if (!options.recursive && cursor !== normalized)
                        throw posixError("ENOENT", `No such directory: ${parentPath(cursor)}`);
                    const { directory, name } = scope.#parent(state, cursor);
                    setEntry(directory.entries, name, scope.#newInode(state, {
                        kind: "directory",
                        mode: 0o755,
                        mtime: now(),
                        entries: Object.create(null),
                    }));
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
        return Object.entries(node.entries)
            .map(([name, inode]) => {
            const child = this.#node(state, inode);
            return {
                name,
                isFile: child.kind === "file",
                isDirectory: child.kind === "directory",
                isSymbolicLink: child.kind === "symlink",
            };
        })
            .sort((left, right) => left.name.localeCompare(right.name));
    }
    async readdir(path) {
        return (await this.readdirWithFileTypes(path)).map((entry) => entry.name);
    }
    async rm(path, options) {
        await this.#exclusive(async (scope) => scope.#removeEntry(scope.#current(), path, options));
    }
    #assertOutsideDirectory(state, source, destination) {
        let candidate = normalizePath(destination);
        let destinationInode;
        for (;;) {
            try {
                destinationInode = this.#resolve(state, candidate);
                break;
            }
            catch (error) {
                if (!(error instanceof OpfsFsError) || error.code !== "ENOENT" || candidate === "/")
                    throw error;
                candidate = parentPath(candidate);
            }
        }
        const contains = (inode) => {
            if (inode === destinationInode)
                return true;
            const node = this.#node(state, inode);
            return (node.kind === "directory" &&
                Object.values(node.entries).some((child) => this.#node(state, child).kind === "directory" && contains(child)));
        };
        if (contains(source))
            throw posixError("EINVAL", `Cannot place a directory inside itself: ${destination}`);
    }
    async cp(source, destination, options = {}) {
        await this.#exclusive(async (scope) => {
            const state = scope.#current();
            const copy = async (from, to) => {
                const inode = scope.#resolve(state, from, false);
                const node = scope.#node(state, inode);
                if (node.kind === "directory") {
                    if (!options.recursive)
                        throw posixError("EISDIR", `Cannot copy directory without recursive: ${from}`);
                    scope.#assertOutsideDirectory(state, inode, to);
                    await scope.mkdir(to, { recursive: true });
                    for (const name of Object.keys(node.entries))
                        await copy(normalizePath(name, from), normalizePath(name, to));
                    return;
                }
                if (node.kind === "symlink") {
                    await scope.symlink(node.target, to);
                    return;
                }
                await scope.writeFile(to, await scope.#readObject(node.content), { mode: node.mode });
            };
            await copy(source, destination);
        });
    }
    async mv(source, destination) {
        await this.#exclusive(async (scope) => {
            const state = scope.#current();
            const sourcePath = normalizePath(source);
            const destinationPath = normalizePath(destination);
            if (sourcePath === destinationPath)
                return;
            const sourceParent = scope.#parent(state, sourcePath);
            const inode = entry(sourceParent.directory.entries, sourceParent.name);
            if (!inode)
                throw posixError("ENOENT", `No such file or directory: ${source}`);
            const node = scope.#node(state, inode);
            if (node.kind === "directory")
                scope.#assertOutsideDirectory(state, inode, parentPath(destinationPath));
            const destinationParent = scope.#parent(state, destinationPath);
            const destinationInode = entry(destinationParent.directory.entries, destinationParent.name);
            if (destinationInode === inode)
                return;
            if (destinationInode) {
                const destinationNode = scope.#node(state, destinationInode);
                if (destinationNode.kind === "directory" && node.kind !== "directory")
                    throw posixError("EISDIR", `Cannot replace directory: ${destination}`);
                if (destinationNode.kind !== "directory" && node.kind === "directory")
                    throw posixError("ENOTDIR", `Cannot replace non-directory: ${destination}`);
                scope.#removeEntry(state, destinationPath);
            }
            delete sourceParent.directory.entries[sourceParent.name];
            setEntry(destinationParent.directory.entries, destinationParent.name, inode);
        });
    }
    resolvePath(base, path) {
        return normalizePath(path, base);
    }
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
    async chmod(path, mode) {
        await this.#exclusive(async (scope) => {
            const state = scope.#current();
            scope.#node(state, scope.#resolve(state, path, false)).mode = mode;
        });
    }
    async symlink(target, path) {
        await this.#exclusive(async (scope) => {
            const state = scope.#current();
            const { directory, name } = scope.#parent(state, path);
            if (entry(directory.entries, name))
                throw posixError("EEXIST", `Path already exists: ${path}`);
            setEntry(directory.entries, name, scope.#newInode(state, { kind: "symlink", mode: 0o777, mtime: now(), target }));
        });
    }
    async link(existingPath, path) {
        await this.#exclusive(async (scope) => {
            const state = scope.#current();
            const inode = scope.#resolve(state, existingPath);
            const node = scope.#node(state, inode);
            if (node.kind !== "file")
                throw posixError("EPERM", `Hard links require a regular file: ${existingPath}`);
            const { directory, name } = scope.#parent(state, path);
            if (entry(directory.entries, name))
                throw posixError("EEXIST", `Path already exists: ${path}`);
            setEntry(directory.entries, name, inode);
            node.links += 1;
        });
    }
    async readlink(path) {
        await this.#refresh();
        const state = this.#current();
        const node = this.#node(state, this.#resolve(state, path, false));
        if (node.kind !== "symlink")
            throw posixError("EINVAL", `Not a symbolic link: ${path}`);
        return node.target;
    }
    async realpath(path) {
        await this.#refresh();
        return this.#realpath(this.#current(), path);
    }
    async utimes(path, _atime, mtime) {
        await this.#exclusive(async (scope) => {
            const state = scope.#current();
            scope.#node(state, scope.#resolve(state, path, false)).mtime = mtime.getTime();
        });
    }
    async transaction(operation) {
        this.#assertOpen();
        if (this.#transaction)
            throw new ConflictError("Nested OPFS workspace transactions are not supported.");
        return this.#exclusive(async (scope) => {
            // Queue only caller-facing operations; internal recursive operations run on the scope directly.
            let accepting = true;
            let pending = Promise.resolve();
            let failed = false;
            let failure;
            const enqueue = (method) => (...args) => {
                if (!accepting)
                    return Promise.reject(new OpfsFsError("CLOSED", "This transaction has finished."));
                const result = pending.then(() => {
                    if (failed)
                        throw failure;
                    return method(...args);
                });
                pending = result.then(() => undefined, (error) => {
                    failed = true;
                    failure = error;
                });
                return result;
            };
            const filesystem = {
                readFile: enqueue(scope.readFile.bind(scope)),
                readFileBytes: enqueue(scope.readFileBytes.bind(scope)),
                readFileBuffer: enqueue(scope.readFileBuffer.bind(scope)),
                writeFile: enqueue(scope.writeFile.bind(scope)),
                appendFile: enqueue(scope.appendFile.bind(scope)),
                exists: enqueue(scope.exists.bind(scope)),
                stat: enqueue(scope.stat.bind(scope)),
                lstat: enqueue(scope.lstat.bind(scope)),
                mkdir: enqueue(scope.mkdir.bind(scope)),
                readdir: enqueue(scope.readdir.bind(scope)),
                readdirWithFileTypes: enqueue(scope.readdirWithFileTypes.bind(scope)),
                rm: enqueue(scope.rm.bind(scope)),
                cp: enqueue(scope.cp.bind(scope)),
                mv: enqueue(scope.mv.bind(scope)),
                resolvePath: scope.resolvePath.bind(scope),
                getAllPaths: scope.getAllPaths.bind(scope),
                chmod: enqueue(scope.chmod.bind(scope)),
                symlink: enqueue(scope.symlink.bind(scope)),
                link: enqueue(scope.link.bind(scope)),
                readlink: enqueue(scope.readlink.bind(scope)),
                realpath: enqueue(scope.realpath.bind(scope)),
                utimes: enqueue(scope.utimes.bind(scope)),
            };
            try {
                const result = await operation(filesystem);
                accepting = false;
                await pending;
                if (failed)
                    throw failure;
                return result;
            }
            finally {
                accepting = false;
                // Drain work started before callback completion before publishing or rolling back.
                await pending;
            }
        });
    }
    async exportArchive(options) {
        if (options.format !== "tar")
            throw posixError("EINVAL", `Unsupported archive format: ${options.format}`);
        return this.#read(async () => {
            const state = this.#current();
            const entries = [];
            const hardlinks = new Map();
            const walk = async (inode, path) => {
                const node = this.#node(state, inode);
                const relative = path === this.root ? "" : path.slice(this.root.length).replace(/^\//, "");
                if (node.kind === "directory") {
                    if (relative)
                        entries.push({
                            path: relative,
                            data: new Uint8Array(),
                            mode: node.mode,
                            mtime: new Date(node.mtime),
                            type: "directory",
                        });
                    for (const [name, child] of Object.entries(node.entries))
                        await walk(child, normalizePath(name, path));
                }
                else if (node.kind === "file") {
                    const previous = hardlinks.get(inode);
                    entries.push(previous === undefined
                        ? {
                            path: relative,
                            data: await this.#readObject(node.content),
                            mode: node.mode,
                            mtime: new Date(node.mtime),
                            type: "file",
                        }
                        : {
                            path: relative,
                            data: new Uint8Array(),
                            mode: node.mode,
                            mtime: new Date(node.mtime),
                            type: "hardlink",
                            linkTarget: previous,
                        });
                    hardlinks.set(inode, previous ?? relative);
                }
                else
                    entries.push({
                        path: relative,
                        data: new Uint8Array(),
                        mode: node.mode,
                        mtime: new Date(node.mtime),
                        type: "symlink",
                        linkTarget: node.target,
                    });
            };
            await walk(this.#resolve(state, this.root), this.root);
            return new Blob([new Uint8Array(encodeTar(entries))], { type: "application/x-tar" });
        });
    }
    async importArchive(archive) {
        const bytes = archive instanceof Uint8Array ? archive : new Uint8Array(await archive.arrayBuffer());
        const entries = decodeTar(bytes);
        await this.#exclusive(async (scope) => {
            let pendingLinks = [];
            for (const entry of entries) {
                if (entry.path.startsWith("/") || entry.path.split("/").includes(".."))
                    throw posixError("EPERM", `Archive path escapes the workspace: ${entry.path}`);
                const path = normalizePath(entry.path, this.root);
                scope.#assertNoSymlinkPath(scope.#current(), path);
                if (entry.type === "directory") {
                    await scope.mkdir(path, { recursive: true });
                    await scope.utimes(path, entry.mtime, entry.mtime);
                }
                else if (entry.type === "symlink") {
                    await scope.mkdir(parentPath(path), { recursive: true });
                    await scope.symlink(entry.linkTarget ?? "", path);
                    await scope.utimes(path, entry.mtime, entry.mtime);
                }
                else if (entry.type === "hardlink") {
                    const target = entry.linkTarget ?? "";
                    if (!target || target.startsWith("/") || target.split("/").includes(".."))
                        throw posixError("EPERM", `Archive link escapes the workspace: ${target}`);
                    pendingLinks.push(entry);
                    continue;
                }
                else {
                    await scope.mkdir(parentPath(path), { recursive: true });
                    await scope.writeFile(path, entry.data, { mode: entry.mode });
                    await scope.utimes(path, entry.mtime, entry.mtime);
                }
                await scope.chmod(path, entry.mode);
            }
            // TAR may declare a hardlink before its target, including chains of hardlinks.
            while (pendingLinks.length > 0) {
                const unresolved = [];
                for (const entry of pendingLinks) {
                    const path = normalizePath(entry.path, this.root);
                    const target = normalizePath(entry.linkTarget ?? "", this.root);
                    scope.#assertNoSymlinkPath(scope.#current(), path);
                    scope.#assertNoSymlinkPath(scope.#current(), target);
                    if (!(await scope.exists(target))) {
                        unresolved.push(entry);
                        continue;
                    }
                    await scope.mkdir(parentPath(path), { recursive: true });
                    await scope.link(target, path);
                    await scope.chmod(path, entry.mode);
                    await scope.utimes(path, entry.mtime, entry.mtime);
                }
                if (unresolved.length === pendingLinks.length)
                    throw posixError("ENOENT", `Unresolved or cyclic archive hardlinks: ${unresolved.map((entry) => `${entry.path} -> ${entry.linkTarget}`).join(", ")}`);
                pendingLinks = unresolved;
            }
        });
    }
    async reset() {
        await this.#exclusive(async (scope) => {
            scope.#purgeHistory = true;
            const draft = scope.#current();
            const fresh = emptyState(scope.root);
            draft.generation = fresh.generation;
            draft.nextInode = fresh.nextInode;
            draft.root = fresh.root;
            draft.inodes = fresh.inodes;
        });
    }
    close() {
        this.#channel?.close();
        this.#channel = undefined;
        this.#listeners.clear();
        this.#closed = true;
    }
}
_a = OpfsWorkspace;
export const openWorkspace = (options) => OpfsWorkspace.open(options);
//# sourceMappingURL=workspace.js.map