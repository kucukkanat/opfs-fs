import { chromium } from "playwright-core"

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/")
      return new Response("<!doctype html><title>OPFS benchmark</title>", { headers: { "content-type": "text/html" } })
    if (!/^\/[a-z-]+\.js$/.test(path)) return new Response("Not found", { status: 404 })
    return new Response(Bun.file(`${import.meta.dir}/../dist${path}`), {
      headers: { "content-type": "text/javascript" },
    })
  },
})
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
})
try {
  const page = await browser.newPage()
  await page.goto(server.url.toString())
  const results = await page.evaluate(async () => {
    // Importing the published ESM exercises the same OPFS path as browser consumers.
    const moduleUrl = new URL("/index.js", location.href).href
    const { openWorkspace }: typeof import("../src/index.js") = await import(moduleUrl)
    const samples: { workload: string; milliseconds: number; operations: number }[] = []
    const measure = async (workload: string, operations: number, run: () => Promise<void>) => {
      const start = performance.now()
      await run()
      samples.push({ workload, operations, milliseconds: Math.round((performance.now() - start) * 10) / 10 })
    }
    const fs = await openWorkspace({ name: `benchmark-${crypto.randomUUID()}` })
    try {
      await measure("100 individual small-file commits", 100, async () => {
        for (let index = 0; index < 100; index++) await fs.writeFile(`/file-${index}`, "hello")
      })
      await fs.reset()
      await measure("100 small files in one transaction", 100, async () => {
        await fs.transaction(async (tx) => {
          for (let index = 0; index < 100; index++) await tx.writeFile(`/file-${index}`, "hello")
        })
      })
      await fs.writeFile("/log", new Uint8Array(256 * 1024))
      await measure("100 one-KiB appends to a 256-KiB file", 100, async () => {
        for (let index = 0; index < 100; index++) await fs.appendFile("/log", new Uint8Array(1024))
      })
      await measure("export 101 files", 1, async () => {
        await fs.exportArchive({ format: "tar" })
      })
      return { browser: navigator.userAgent, samples }
    } finally {
      await fs.reset()
      fs.close()
    }
  })
  console.log(JSON.stringify(results, null, 2))
} finally {
  await browser.close()
  server.stop(true)
}
