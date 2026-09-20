# Browser agent workspace example

A runnable consumer of `@kucukkanat/opfs-fs` and `libfx/browser`: persist a text file across reloads, then save and restore a real fx WebAssembly agent checkpoint. No model requests, credentials, framework, or backend storage are involved.

From the repository root:

```sh
bun install
bun run --filter '@kucukkanat/opfs-fs' build
bun run --cwd examples/browser-agent start
```

Open the localhost URL. Save the note, reload, and click **Restore file**. Click **Save and restore checkpoint** to exercise the real fx runtime. OPFS requires a secure context; localhost works. The checkpoint demonstration additionally requires WebAssembly JSPI and reports a useful error when unsupported.

The Bun server binds to localhost and serves the installed `libfx/fx-core.wasm`. Set `PORT=3001` to choose another port. `bun run --cwd examples/browser-agent build` emits a static `dist` directory; serve it over localhost or HTTPS.

`src/main.ts` is the integration example. `createFxCheckpointStore()` stores opaque bytes and leaves agent ownership with the application. Restore credentials, model configuration, and tools separately when extending this into a prompted agent. Never put a long-lived model key in client code. The placeholder here only satisfies initialization validation; the example never calls `prompt()`.

Run the real-browser smoke test separately:

```sh
bun run --cwd examples/browser-agent test:e2e
```

Set `CHROME_BIN` when Chrome is installed outside the default macOS location. The test exercises actual OPFS and fx WebAssembly and asserts that no external network requests occur.
