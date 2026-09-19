export type FileKind = "file" | "directory" | "symlink"

export type FileStat = Readonly<{
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
  mode: number
  size: number
  mtime: Date
  identity: string
}>

export type DirectoryEntry = Readonly<{
  name: string
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
}>

export type ReadEncoding = "utf8" | "utf-8" | "ascii" | "binary" | "latin1"
export type FileContent = string | Uint8Array
export type WriteOptions = Readonly<{ encoding?: ReadEncoding; mode?: number }>
export type MkdirOptions = Readonly<{ recursive?: boolean }>
export type RmOptions = Readonly<{ recursive?: boolean; force?: boolean }>
export type WorkspaceStorageEstimate = Readonly<{ usage?: number; quota?: number }>

export type OpenWorkspaceOptions = Readonly<{
  name: string
  root?: string
}>

export type ArchiveFormat = "tar"

export interface WorkspaceFileSystem {
  readFile(path: string, options?: ReadEncoding | Readonly<{ encoding?: ReadEncoding }>): Promise<string>
  readFileBytes(path: string): Promise<string>
  readFileBuffer(path: string): Promise<Uint8Array>
  writeFile(path: string, content: FileContent, options?: WriteOptions | ReadEncoding): Promise<void>
  appendFile(path: string, content: FileContent, options?: WriteOptions | ReadEncoding): Promise<void>
  exists(path: string): Promise<boolean>
  stat(path: string): Promise<FileStat>
  lstat(path: string): Promise<FileStat>
  mkdir(path: string, options?: MkdirOptions): Promise<void>
  readdir(path: string): Promise<string[]>
  readdirWithFileTypes(path: string): Promise<DirectoryEntry[]>
  rm(path: string, options?: RmOptions): Promise<void>
  cp(source: string, destination: string, options?: Readonly<{ recursive?: boolean }>): Promise<void>
  mv(source: string, destination: string): Promise<void>
  resolvePath(base: string, path: string): string
  getAllPaths(): string[]
  chmod(path: string, mode: number): Promise<void>
  symlink(target: string, path: string): Promise<void>
  link(existingPath: string, path: string): Promise<void>
  readlink(path: string): Promise<string>
  realpath(path: string): Promise<string>
  utimes(path: string, atime: Date, mtime: Date): Promise<void>
}
