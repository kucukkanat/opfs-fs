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

## just-bash

```ts
import { Bash } from "just-bash/browser"
import { createJustBashFileSystem } from "@kucukkanat/opfs-fs/just-bash"

const bash = new Bash({ fs: createJustBashFileSystem(fs), cwd: "/workspace" })
```
