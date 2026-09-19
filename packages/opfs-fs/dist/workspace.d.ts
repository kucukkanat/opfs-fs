import type { ArchiveFormat, DirectoryEntry, FileContent, FileStat, MkdirOptions, OpenWorkspaceOptions, ReadEncoding, RmOptions, WorkspaceFileSystem, WorkspaceStorageEstimate, WriteOptions } from "./types.js";
export declare class OpfsWorkspace implements WorkspaceFileSystem {
    #private;
    readonly name: string;
    readonly root: string;
    readonly storage: Readonly<{
        estimate: () => Promise<WorkspaceStorageEstimate>;
        requestPersistence: () => Promise<boolean>;
    }>;
    private constructor();
    static open(options: OpenWorkspaceOptions): Promise<OpfsWorkspace>;
    readFileBuffer(path: string): Promise<Uint8Array>;
    readFileBytes(path: string): Promise<string>;
    readFile(path: string, options?: ReadEncoding | Readonly<{
        encoding?: ReadEncoding;
    }>): Promise<string>;
    writeFile(path: string, content: FileContent, options?: WriteOptions | ReadEncoding): Promise<void>;
    appendFile(path: string, content: FileContent, options?: WriteOptions | ReadEncoding): Promise<void>;
    exists(path: string): Promise<boolean>;
    stat(path: string): Promise<FileStat>;
    lstat(path: string): Promise<FileStat>;
    mkdir(path: string, options?: MkdirOptions): Promise<void>;
    readdirWithFileTypes(path: string): Promise<DirectoryEntry[]>;
    readdir(path: string): Promise<string[]>;
    rm(path: string, options?: RmOptions): Promise<void>;
    cp(source: string, destination: string, options?: Readonly<{
        recursive?: boolean;
    }>): Promise<void>;
    mv(source: string, destination: string): Promise<void>;
    resolvePath(base: string, path: string): string;
    getAllPaths(): string[];
    chmod(path: string, mode: number): Promise<void>;
    symlink(target: string, path: string): Promise<void>;
    link(existingPath: string, path: string): Promise<void>;
    readlink(path: string): Promise<string>;
    realpath(path: string): Promise<string>;
    utimes(path: string, _atime: Date, mtime: Date): Promise<void>;
    transaction<Value>(operation: (filesystem: WorkspaceFileSystem) => Promise<Value>): Promise<Value>;
    exportArchive(options: Readonly<{
        format: ArchiveFormat;
    }>): Promise<Blob>;
    importArchive(archive: Blob | Uint8Array): Promise<void>;
    reset(): Promise<void>;
    close(): void;
}
export declare const openWorkspace: (options: OpenWorkspaceOptions) => Promise<OpfsWorkspace>;
//# sourceMappingURL=workspace.d.ts.map