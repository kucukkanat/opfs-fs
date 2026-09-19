# opfs-fs

`@kucukkanat/opfs-fs` is an ergonomic, durable browser filesystem on OPFS.
It is a Bun workspace containing the core SDK and its `just-bash` adapter.

## Install from GitHub

The committed ESM build makes the main branch directly consumable before an npm
release:

```sh
npm install @kucukkanat/opfs-fs@github:kucukkanat/opfs-fs#main
```

The import specifiers are identical to the registry package:

```ts
import { openWorkspace } from "@kucukkanat/opfs-fs"
import { createJustBashFileSystem } from "@kucukkanat/opfs-fs/just-bash"
```

```sh
bun install
bun run build
bun test
bun run test:integration
```

The integration suite is reserved for real-browser OPFS tests; it is separate
from pure unit tests by design.
