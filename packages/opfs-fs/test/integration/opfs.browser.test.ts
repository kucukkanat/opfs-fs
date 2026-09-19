import { afterAll, beforeAll, expect, test } from "bun:test"
import { chromium, type Browser } from "playwright-core"

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const dist = `${import.meta.dir}/../../dist`
let browser: Browser | undefined
let server: ReturnType<typeof Bun.serve> | undefined

beforeAll(async () => {
  browser = await chromium.launch({ executablePath: chrome, headless: true })
  server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname
      if (path === "/") return new Response("<!doctype html><title>opfs-fs test</title>", { headers: { "content-type": "text/html" } })
      if (!path.endsWith(".js") || path.includes("..")) return new Response("Not found", { status: 404 })
      const file = Bun.file(`${dist}${path}`)
      return new Response(await file.arrayBuffer(), { headers: { "content-type": "text/javascript" } })
    },
  })
})

afterAll(async () => {
  server?.stop(true)
  await browser?.close()
})

test("persists a workspace across independent browser pages", async () => {
  const activeBrowser = browser
  const activeServer = server
  if (!activeBrowser || !activeServer) throw new Error("Browser test setup failed.")
  const workspace = `opfs-fs-${crypto.randomUUID()}`
  const context = await activeBrowser.newContext()
  const first = await context.newPage()
  await first.goto(activeServer.url.toString())
  await first.evaluate(async (name) => {
    const { openWorkspace } = await import("/index.js")
    const fs = await openWorkspace({ name, root: "/workspace" })
    await fs.writeFile("/workspace/note.txt", "durable")
    fs.close()
  }, workspace)
  await first.close()

  const second = await context.newPage()
  await second.goto(activeServer.url.toString())
  expect(await second.evaluate(async (name) => {
    const { openWorkspace } = await import("/index.js")
    const fs = await openWorkspace({ name, root: "/workspace" })
    const value = await fs.readFile("/workspace/note.txt")
    fs.close()
    return value
  }, workspace)).toBe("durable")
  await second.close()
  await context.close()
})

test("preserves links, transactions, and archive round trips", async () => {
  const activeBrowser = browser
  const activeServer = server
  if (!activeBrowser || !activeServer) throw new Error("Browser test setup failed.")
  const page = await activeBrowser.newPage()
  await page.goto(activeServer.url.toString())
  expect(await page.evaluate(async (name) => {
    const { openWorkspace } = await import("/index.js")
    const fs = await openWorkspace({ name, root: "/workspace" })
    await fs.transaction(async (tx) => {
      await tx.mkdir("/workspace/src", { recursive: true })
      await tx.writeFile("/workspace/src/note.txt", "one")
      await tx.link("/workspace/src/note.txt", "/workspace/src/alias.txt")
      await tx.symlink("note.txt", "/workspace/src/link.txt")
    })
    await fs.appendFile("/workspace/src/alias.txt", " two")
    const archive = await fs.exportArchive({ format: "tar" })
    await fs.reset()
    const missing = await fs.exists("/workspace/src/note.txt")
    await fs.importArchive(archive)
    const result = {
      alias: await fs.readFile("/workspace/src/alias.txt"),
      symlink: await fs.readFile("/workspace/src/link.txt"),
      resolved: await fs.realpath("/workspace/src/link.txt"),
      restored: await fs.readFile("/workspace/src/note.txt"),
      missing,
    }
    fs.close()
    return result
  }, `opfs-fs-${crypto.randomUUID()}`)).toEqual({ alias: "one two", symlink: "one two", resolved: "/workspace/src/note.txt", restored: "one two", missing: false })
  await page.close()
})
