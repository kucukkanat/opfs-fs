import { afterAll, beforeAll, expect, test } from "bun:test"
import { chromium, type Browser } from "playwright-core"

let browser: Browser | undefined
let server: ReturnType<typeof Bun.serve> | undefined

beforeAll(async () => {
  const entrypoints = new Map([
    ["/workspace.js", `${import.meta.dir}/../../src/index.ts`],
    ["/checkpoint.js", `${import.meta.dir}/../../src/fx.ts`],
    ["/libfx.js", `${import.meta.dir}/../../node_modules/libfx/browser.js`],
  ])
  const files = new Map<string, Blob>()
  for (const [url, entrypoint] of entrypoints) {
    const bundle = await Bun.build({ entrypoints: [entrypoint], target: "browser" })
    const output = bundle.outputs[0]
    if (!bundle.success || !output) throw new Error(`Cannot bundle ${url}: ${bundle.logs.join("\n")}`)
    files.set(url, output)
  }
  files.set("/fx-core.wasm", Bun.file(`${import.meta.dir}/../../node_modules/libfx/fx-core.wasm`))
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname
      if (path === "/")
        return new Response("<!doctype html><title>libfx OPFS</title>", { headers: { "content-type": "text/html" } })
      const file = files.get(path)
      return file
        ? new Response(file, {
            headers: { "content-type": path.endsWith(".wasm") ? "application/wasm" : "text/javascript" },
          })
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

test("real libfx checkpoints persist through OPFS and restore without model requests", async () => {
  if (!browser || !server) throw new Error("Browser setup failed")
  const page = await browser.newPage()
  const externalRequests: string[] = []
  const origin = server.url.origin
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== origin) externalRequests.push(request.url())
  })
  try {
    await page.goto(server.url.toString())
    const result = await page.evaluate(async () => {
      const { openWorkspace } = await import("/workspace.js")
      const { createFxCheckpointStore } = await import("/checkpoint.js")
      const { createFxAgent, supportsJspi } = await import("/libfx.js")
      if (!supportsJspi())
        throw new Error(
          "libfx integration requires a browser with WebAssembly JSPI; update CHROME_BIN to a supported Chrome.",
        )
      const name = crypto.randomUUID()
      const workspace = await openWorkspace({ name })
      const store = createFxCheckpointStore(workspace, "/agent.checkpoint")
      const missing = await store.load()
      const options = { apiKey: "local-checkpoint-test-no-model-request", wasm: "/fx-core.wasm" }
      const agent = await createFxAgent(options)
      try {
        await store.save(agent)
      } finally {
        await agent.close()
      }
      const before = await store.load()
      workspace.close()
      const reopened = await openWorkspace({ name })
      const persisted = await createFxCheckpointStore(reopened, "/agent.checkpoint").load()
      const restored = await createFxAgent({ ...options, checkpoint: persisted })
      let after: Uint8Array
      try {
        after = await restored.checkpoint()
      } finally {
        await restored.close()
      }
      reopened.close()
      return {
        missing: missing === undefined,
        bytes: before?.length,
        persisted: Array.from(persisted),
        restored: Array.from(after),
      }
    })
    expect(result.missing).toBe(true)
    expect(result.bytes).toBeGreaterThan(0)
    expect(result.restored).toEqual(result.persisted)
    expect(externalRequests).toEqual([])
  } finally {
    await page.close()
  }
}, 20_000)
