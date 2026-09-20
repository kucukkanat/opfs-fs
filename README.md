# opfs-fs

`@kucukkanat/opfs-fs` gives browser agents and local-first applications persistent files, atomic transactions, and a shared filesystem for `just-bash`. Reopen the same named workspace after a reload, or export its files as TAR.

[Try the live file editor](https://kucukkanat.github.io/opfs-fs/#try-it-in-your-browser) · [Run the editable terminal](https://kucukkanat.github.io/opfs-fs/xterm/#editable-live-example) · [Build a browser agent](https://kucukkanat.github.io/opfs-fs/agents/)

## Install from GitHub

The committed ESM build makes the main branch directly consumable before an npm
release:

```sh
npm install @kucukkanat/opfs-fs@github:kucukkanat/opfs-fs#main
```

Once a release is available on npm, install the same package with
`npm install @kucukkanat/opfs-fs`. Until then, the GitHub dependency above is
the supported installation path.

The import specifiers are identical to the registry package:

```ts
import { openWorkspace } from "@kucukkanat/opfs-fs"

const fs = await openWorkspace({ name: "my-project", root: "/workspace" })
try {
  await fs.writeFile("/workspace/hello.txt", "Saved in this browser\n")
  console.log(await fs.readFile("/workspace/hello.txt"))
} finally {
  fs.close()
}
```

Run this on the browser client over HTTPS or localhost. OPFS, Web Locks and Web Crypto are required; there is no volatile fallback. Storage belongs to the origin and can be cleared or evicted. `root` is an initial directory, not a security boundary. See [operations](https://kucukkanat.github.io/opfs-fs/lifecycle/) for capabilities, quotas and recovery.

The optional [just-bash adapter](https://kucukkanat.github.io/opfs-fs/just-bash/) needs `just-bash` and its documented browser compression alias. [React](https://kucukkanat.github.io/opfs-fs/react/), xterm.js and wterm recipes cover lifecycle ownership. The core package does not depend on a UI framework.

## Run the starter

After cloning this repository:

```sh
bun install
bun run example
```

Open the printed localhost URL. [examples/browser-agent](examples/browser-agent) contains the runnable consumer and browser bundler setup.

## Develop this repository

This Bun monorepo contains the SDK and documentation app.

```sh
bun install
bun run build
bun run test
bun run test:integration
bun run test:e2e
```

Unit, integration and browser E2E suites are separate commands. Browser suites require Chrome; set `CHROME_BIN` to its executable path. Run `bun run docs:dev` for the local documentation app.

Developer documentation and live terminal integrations are available at
[kucukkanat.github.io/opfs-fs](https://kucukkanat.github.io/opfs-fs/).
