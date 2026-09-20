# @kucukkanat/opfs-fs

Persistent files for browser agents and local-first applications, built on the Origin Private File System.

[Try the file editor](https://kucukkanat.github.io/opfs-fs/#try-it-in-your-browser) · [API reference](https://kucukkanat.github.io/opfs-fs/api/) · [Browser-agent recipes](https://kucukkanat.github.io/opfs-fs/agents/)

## Install

```sh
npm install @kucukkanat/opfs-fs@github:kucukkanat/opfs-fs#main
```

Once a registry release is available, use `npm install @kucukkanat/opfs-fs`.

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

`opfs-fs` uses byte-oriented reads and writes rather than filesystem stream
methods. Use `readFileBuffer()`/`writeFile(new Uint8Array(...))`, or consume an
exported archive with the browser's `Blob.stream()`.

## just-bash

Use the filesystem adapter when you own the `Bash` lifecycle:

```ts
import { Bash } from "just-bash/browser"
import { installBrowserBuffer } from "@kucukkanat/opfs-fs/browser-zlib"
import { createJustBashFileSystem } from "@kucukkanat/opfs-fs/just-bash"

installBrowserBuffer()
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

await shell.dispose()
```


## Browser integration

Open workspaces in a secure browser context (HTTPS or localhost), after client initialization. The package is ESM-only; no server-side OPFS fallback is provided. [React lifecycle](https://kucukkanat.github.io/opfs-fs/react/) and [environment requirements](https://kucukkanat.github.io/opfs-fs/lifecycle/#environment-requirements) cover setup and cleanup.

The `just-bash` browser dependency graph needs the documented [`node:zlib` alias and optional `fflate` and `buffer` peers](https://kucukkanat.github.io/opfs-fs/just-bash/#browser-bundlers-and-compression). The filesystem core does not require compression or React.

`root` is an initial directory and archive root, not a sandbox. Modes are metadata; `utimes` currently stores modification time only. Reads and archives are memory-backed operations. Preserve important data with explicit exports: browser eviction and clearing site data can remove OPFS files.

Inside `transaction()`, use and await the callback's `tx` operations. Do not await outer workspace writes while holding the transaction lock, or retain its handle after completion.
