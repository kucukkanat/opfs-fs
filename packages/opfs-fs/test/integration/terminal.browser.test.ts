import { afterAll, beforeAll, expect, test } from "bun:test"
import { resolve } from "node:path"
import { chromium, type Browser } from "playwright-core"

let browser: Browser | undefined
let server: ReturnType<typeof Bun.serve> | undefined

beforeAll(async () => {
  const bundles = await Promise.all([
    Bun.build({
      entrypoints: [`${import.meta.dir}/../../src/just-bash.ts`],
      target: "browser",
      plugins: [
        {
          name: "browser-zlib",
          setup(build) {
            build.onResolve({ filter: /^node:zlib$/ }, () => ({
              path: resolve(import.meta.dir, "../../src/browser-zlib.ts"),
            }))
          },
        },
      ],
      external: ["@mongodb-js/zstd", "node-liblzma"],
    }),
    Bun.build({ entrypoints: [`${import.meta.dir}/../../src/browser-zlib.ts`], target: "browser" }),
    Bun.build({ entrypoints: [`${import.meta.dir}/../../src/index.ts`], target: "browser" }),
    Bun.build({
      entrypoints: [`${import.meta.dir}/../../../../apps/docs/node_modules/@xterm/xterm/lib/xterm.mjs`],
      target: "browser",
    }),
  ])
  const files = new Map<string, Blob>()
  for (const [index, name] of ["adapter", "zlib", "workspace", "xterm"].entries()) {
    const bundle = bundles[index]
    const output = bundle?.outputs[0]
    if (!bundle?.success || !output) throw new Error(`Cannot bundle ${name}: ${bundle?.logs.join("\n")}`)
    files.set(`/${name}.js`, output)
  }
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname
      if (path === "/")
        return new Response("<!doctype html><body><div id='terminal'></div>", {
          headers: { "content-type": "text/html" },
        })
      const file = files.get(path)
      return file
        ? new Response(file, { headers: { "content-type": "text/javascript" } })
        : new Response("Not found", { status: 404 })
    },
  })
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  })
})

afterAll(async () => {
  await browser?.close()
  server?.stop(true)
})

test("real xterm attachment binds methods and honors borrowed and owned workspaces", async () => {
  if (!browser || !server) throw new Error("Browser setup failed")
  const page = await browser.newPage()
  try {
    await page.goto(server.url.toString())
    const result = await page.evaluate(async () => {
      const { attachJustBashTerminal, createJustBashFileSystem } = await import("/adapter.js")
      const { openWorkspace } = await import("/workspace.js")
      const { Terminal } = await import("/xterm.js")
      const { installBrowserBuffer } = await import("/zlib.js")
      installBrowserBuffer()
      const element = document.querySelector("#terminal")
      if (!(element instanceof HTMLElement)) throw new Error("Terminal element missing")
      const terminal = new Terminal()
      terminal.open(element)
      const workspace = await openWorkspace({ name: crypto.randomUUID(), root: "/work" })
      const shell = await attachJustBashTerminal({
        terminal,
        workspace: { instance: workspace, ownership: "borrowed" },
      })
      terminal.input("echo terminal > /work/input\r")
      const input = await shell.execute("cat /work/input")
      const gzip = await shell.execute("gzip -c /work/input > /work/input.gz; gunzip -c /work/input.gz")
      await workspace.transaction(async (filesystem) => {
        const adapter = createJustBashFileSystem(filesystem)
        await adapter.writeFile("/work/transaction", "adapter")
      })
      await shell.dispose()
      const persisted = await workspace.readFile("/work/transaction")
      const owned = await attachJustBashTerminal({ terminal, workspace: { instance: workspace, ownership: "owned" } })
      const closing = owned.dispose()
      terminal.dispose()
      await closing
      let closed = false
      try {
        await workspace.readFile("/work/transaction")
      } catch (error) {
        closed = error instanceof Error && "code" in error && error.code === "CLOSED"
      }
      return {
        stdout: input.stdout,
        gzip: gzip.stdout,
        gzipCode: gzip.exitCode,
        gzipError: gzip.stderr,
        persisted,
        closed,
        jspi: "Suspending" in WebAssembly,
      }
    })
    expect(result).toMatchObject({
      stdout: "terminal\n",
      gzip: "terminal\n",
      gzipCode: 0,
      persisted: "adapter",
      closed: true,
    })
  } finally {
    await page.close()
  }
})
