# @kucukkanat/opfs-fs

Durable, transactional browser workspaces built on the Origin Private File System.

```ts
import { openWorkspace } from "@kucukkanat/opfs-fs"

const fs = await openWorkspace({ name: "agent", root: "/workspace" })
await fs.writeFile("/workspace/hello.txt", "hello")

await fs.transaction(async (tx) => {
  await tx.mkdir("/workspace/src", { recursive: true })
  await tx.mv("/workspace/hello.txt", "/workspace/src/hello.txt")
})
```

Every mutation is committed atomically. Transactions make a group of mutations
visible together. The package requires OPFS, Web Locks, and Web Crypto; it
throws `CapabilityError` rather than silently using volatile storage.

The OPFS layout is intentionally managed and private. It uses inode metadata so
hard links, symlinks, modes, timestamps, and recovery semantics remain coherent.

```ts
const archive = await fs.exportArchive({ format: "tar" })
await fs.importArchive(archive)
await fs.reset()
fs.close()
```

Use `fs.storage.estimate()` to show storage usage and
`fs.storage.requestPersistence()` only from an explicit user action.

## Complete example

The full browser flow—transactions, text and bytes, POSIX metadata and links,
recursive operations, TAR export/import, storage, typed errors, lifecycle, and
`just-bash`—is maintained as one copy-pasteable example in the documentation:
[Complete opfs-fs example](https://kucukkanat.github.io/opfs-fs/complete-example/).

`opfs-fs` v1 uses byte-oriented reads and writes rather than filesystem stream
methods. Use `readFileBuffer()`/`writeFile(new Uint8Array(...))`, or consume an
exported archive with the browser's `Blob.stream()`.

## just-bash

Use the filesystem adapter when you own the `Bash` lifecycle:

```ts
import { Bash } from "just-bash/browser"
import { createJustBashFileSystem } from "@kucukkanat/opfs-fs/just-bash"

const bash = new Bash({ fs: createJustBashFileSystem(fs), cwd: "/workspace" })
```

For a terminal, the high-level adapter opens the workspace and owns the full
shell lifecycle:

```ts
import { attachJustBashTerminal } from "@kucukkanat/opfs-fs/just-bash"

const shell = await attachJustBashTerminal({
  terminal: { write: terminal.write.bind(terminal), onData: terminal.onData.bind(terminal) },
  workspace: { name: "terminal", root: "/workspace" },
})

shell.dispose()
```
