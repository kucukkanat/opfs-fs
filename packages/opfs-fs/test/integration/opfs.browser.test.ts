import { afterAll, beforeAll, expect, test } from "bun:test"
import { type Browser, chromium } from "playwright-core"

const chrome = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const dist = `${import.meta.dir}/../../dist`
let browser: Browser | undefined
let server: ReturnType<typeof Bun.serve> | undefined

beforeAll(async () => {
  browser = await chromium.launch({ executablePath: chrome, headless: true })
  server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname
      if (path === "/")
        return new Response("<!doctype html><title>opfs-fs test</title>", { headers: { "content-type": "text/html" } })
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
  expect(
    await second.evaluate(async (name) => {
      const { openWorkspace } = await import("/index.js")
      const fs = await openWorkspace({ name, root: "/workspace" })
      const value = await fs.readFile("/workspace/note.txt")
      fs.close()
      return value
    }, workspace),
  ).toBe("durable")
  await second.close()
  await context.close()
})

test("serializes concurrent workspace initialization", async () => {
  const activeBrowser = browser
  const activeServer = server
  if (!activeBrowser || !activeServer) throw new Error("Browser test setup failed.")
  const name = `opfs-fs-${crypto.randomUUID()}`
  const context = await activeBrowser.newContext()
  const pages = await Promise.all([context.newPage(), context.newPage()])
  await Promise.all(pages.map((page) => page.goto(activeServer.url.toString())))
  expect(
    await Promise.all(
      pages.map((page) =>
        page.evaluate(async (workspaceName) => {
          const { openWorkspace } = await import("/index.js")
          const fs = await openWorkspace({ name: workspaceName, root: "/workspace" })
          const root = fs.root
          fs.close()
          return root
        }, name),
      ),
    ),
  ).toEqual(["/workspace", "/workspace"])
  const [firstPage] = pages
  if (!firstPage) throw new Error("Browser test setup failed.")
  expect(
    await firstPage.evaluate(async (workspaceName) => {
      const root = await navigator.storage.getDirectory()
      const generations = await (
        await (await root.getDirectoryHandle("kucukkanat-opfs-fs")).getDirectoryHandle("workspaces")
      )
        .getDirectoryHandle(workspaceName)
        .then((directory) => directory.getDirectoryHandle("generations"))
      const names: string[] = []
      for await (const [entry] of generations) names.push(entry)
      return names
    }, name),
  ).toEqual(["1.json"])
  await Promise.all(pages.map((page) => page.close()))
  await context.close()
})

test("preserves links, transactions, and archive round trips", async () => {
  const activeBrowser = browser
  const activeServer = server
  if (!activeBrowser || !activeServer) throw new Error("Browser test setup failed.")
  const page = await activeBrowser.newPage()
  await page.goto(activeServer.url.toString())
  expect(
    await page.evaluate(async (name) => {
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
    }, `opfs-fs-${crypto.randomUUID()}`),
  ).toEqual({
    alias: "one two",
    symlink: "one two",
    resolved: "/workspace/src/note.txt",
    restored: "one two",
    missing: false,
  })
  await page.close()
})

test("rejects destructive moves, recursive self-copies, and escaping archives", async () => {
  const activeBrowser = browser
  const activeServer = server
  if (!activeBrowser || !activeServer) throw new Error("Browser test setup failed.")
  const page = await activeBrowser.newPage()
  await page.goto(activeServer.url.toString())
  expect(
    await page.evaluate(async (name) => {
      const { OpfsFsError, openWorkspace } = await import("/index.js")
      const { encodeTar } = await import("/tar.js")
      const fs = await openWorkspace({ name, root: "/workspace" })
      await fs.mkdir("/workspace/destination", { recursive: true })
      await fs.writeFile("/workspace/destination/keep.txt", "keep")
      await fs.writeFile("/workspace/source.txt", "source")
      await fs.mkdir("/workspace/copy", { recursive: true })
      const errors: string[] = []
      for (const operation of [
        () => fs.mv("/workspace/source.txt", "/workspace/destination"),
        () => fs.cp("/workspace/copy", "/workspace/copy/child", { recursive: true }),
        () =>
          fs.importArchive(
            encodeTar([{ path: "/outside.txt", data: new Uint8Array(), mode: 0o644, mtime: new Date(), type: "file" }]),
          ),
      ]) {
        try {
          await operation()
        } catch (error) {
          if (error instanceof OpfsFsError) errors.push(error.code)
        }
      }
      const kept = await fs.readFile("/workspace/destination/keep.txt")
      fs.close()
      return { errors, kept }
    }, `opfs-fs-${crypto.randomUUID()}`),
  ).toEqual({ errors: ["EISDIR", "EINVAL", "EPERM"], kept: "keep" })
  await page.close()
})

test("reclaims obsolete objects on reset and rejects closed transactions", async () => {
  const activeBrowser = browser
  const activeServer = server
  if (!activeBrowser || !activeServer) throw new Error("Browser test setup failed.")
  const page = await activeBrowser.newPage()
  await page.goto(activeServer.url.toString())
  expect(
    await page.evaluate(async (name) => {
      const { OpfsFsError, openWorkspace } = await import("/index.js")
      const fs = await openWorkspace({ name, root: "/workspace" })
      await fs.writeFile("/workspace/note.txt", "one")
      await fs.writeFile("/workspace/note.txt", "two")
      await fs.reset()
      const root = await navigator.storage.getDirectory()
      const directory = await (
        await (await root.getDirectoryHandle("kucukkanat-opfs-fs")).getDirectoryHandle("workspaces")
      ).getDirectoryHandle(name)
      const objects = await directory.getDirectoryHandle("objects")
      const generations = await directory.getDirectoryHandle("generations")
      const names = async (handle: FileSystemDirectoryHandle): Promise<string[]> => {
        const result: string[] = []
        for await (const [entry] of handle) result.push(entry)
        return result.sort()
      }
      const result = { objects: await names(objects), generations: await names(generations) }
      fs.close()
      let closed = ""
      try {
        await fs.transaction(async () => undefined)
      } catch (error) {
        if (error instanceof OpfsFsError) closed = error.code
      }
      return { ...result, closed }
    }, `opfs-fs-${crypto.randomUUID()}`),
  ).toEqual({ objects: [], generations: ["4.json"], closed: "CLOSED" })
  await page.close()
})

test("isolates suspended transactions and invalidates escaped transaction handles", async () => {
  if (!browser || !server) throw new Error("Browser test setup failed.")
  const page = await browser.newPage()
  await page.goto(server.url.toString())
  expect(
    await page.evaluate(async (name) => {
      const { OpfsFsError, openWorkspace } = await import("/index.js")
      const fs = await openWorkspace({ name })
      let start = (): void => {
        throw new Error("Missing start signal")
      }
      let release = (): void => {
        throw new Error("Missing release signal")
      }
      const started = new Promise<void>((resolve) => {
        start = resolve
      })
      const barrier = new Promise<void>((resolve) => {
        release = resolve
      })
      let escaped: (() => Promise<void>) | undefined
      const transaction = fs
        .transaction(async (tx) => {
          await tx.writeFile("/draft", "private")
          escaped = () => tx.writeFile("/escaped", "no")
          start()
          await barrier
          throw new Error("rollback")
        })
        .then(
          () => "committed",
          (error: unknown) => (error instanceof Error ? error.message : "unknown"),
        )
      await started
      const outside = fs.writeFile("/outside", "durable")
      const read = fs.exists("/draft")
      release()
      const rollback = await transaction
      await outside
      const visible = await read
      let closed = ""
      try {
        await escaped?.()
      } catch (error) {
        if (error instanceof OpfsFsError) closed = error.code
      }
      const result = { rollback, visible, outside: await fs.readFile("/outside"), closed }
      fs.close()
      return result
    }, `opfs-fs-${crypto.randomUUID()}`),
  ).toEqual({ rollback: "rollback", visible: false, outside: "durable", closed: "CLOSED" })
  await page.close()
})

test("supports prototype-like filenames and preserves dangling links when writing", async () => {
  if (!browser || !server) throw new Error("Browser test setup failed.")
  const page = await browser.newPage()
  await page.goto(server.url.toString())
  expect(
    await page.evaluate(async (name) => {
      const { openWorkspace } = await import("/index.js")
      const fs = await openWorkspace({ name })
      for (const path of ["constructor", "toString", "__proto__"]) await fs.writeFile(`/${path}`, path)
      await fs.symlink("missing", "/link")
      await fs.writeFile("/link", "through link")
      await fs.appendFile("/new", "created")
      const result = {
        names: await fs.readdir("/"),
        prototype: await fs.readFile("/__proto__"),
        target: await fs.readFile("/missing"),
        link: await fs.readlink("/link"),
        append: await fs.readFile("/new"),
      }
      fs.close()
      const reopened = await openWorkspace({ name })
      const persisted = await reopened.readFile("/__proto__")
      reopened.close()
      return { ...result, persisted }
    }, `opfs-fs-${crypto.randomUUID()}`),
  ).toEqual({
    names: ["__proto__", "constructor", "link", "missing", "new", "toString"],
    prototype: "__proto__",
    persisted: "__proto__",
    target: "through link",
    link: "missing",
    append: "created",
  })
  await page.close()
})

test("rejects descendant destinations resolved through symlinks", async () => {
  if (!browser || !server) throw new Error("Browser test setup failed.")
  const page = await browser.newPage()
  await page.goto(server.url.toString())
  expect(
    await page.evaluate(async (name) => {
      const { openWorkspace, OpfsFsError } = await import("/index.js")
      const fs = await openWorkspace({ name })
      await fs.mkdir("/a/b", { recursive: true })
      await fs.writeFile("/a/b/keep", "keep")
      await fs.symlink("/a/b", "/alias")
      const errors: string[] = []
      for (const operation of [
        () => fs.mv("/a", "/alias/moved"),
        () => fs.cp("/a", "/alias/deep/copy", { recursive: true }),
      ]) {
        try {
          await operation()
        } catch (error) {
          if (error instanceof OpfsFsError) errors.push(error.code)
        }
      }
      const kept = await fs.readFile("/a/b/keep")
      fs.close()
      return { errors, kept }
    }, `opfs-fs-${crypto.randomUUID()}`),
  ).toEqual({ errors: ["EINVAL", "EINVAL"], kept: "keep" })
  await page.close()
})

test("pins export contents against a concurrent reset and restores metadata and hardlinks", async () => {
  if (!browser || !server) throw new Error("Browser test setup failed.")
  const page = await browser.newPage()
  await page.goto(server.url.toString())
  expect(
    await page.evaluate(async (name) => {
      const { openWorkspace } = await import("/index.js")
      const fs = await openWorkspace({ name })
      await fs.transaction(async (tx) => {
        await tx.mkdir("/private")
        await tx.chmod("/private", 0o700)
        await tx.writeFile("/private/zero", "content", { mode: 0 })
        await tx.link("/private/zero", "/private/alias")
        for (let index = 0; index < 12; index += 1) await tx.writeFile(`/private/${index}`, `file ${index}`)
      })
      const [archive] = await Promise.all([fs.exportArchive({ format: "tar" }), fs.reset()])
      await fs.importArchive(archive)
      await fs.appendFile("/private/alias", " updated")
      const result = {
        directory: (await fs.stat("/private")).mode,
        mode: (await fs.stat("/private/zero")).mode,
        linked: await fs.readFile("/private/zero"),
        last: await fs.readFile("/private/11"),
      }
      fs.close()
      return result
    }, `opfs-fs-${crypto.randomUUID()}`),
  ).toEqual({ directory: 0o700, mode: 0, linked: "content updated", last: "file 11" })
  await page.close()
})

test("reloads every writer under its lock and publishes stable revision snapshots", async () => {
  if (!browser || !server) throw new Error("Browser test setup failed.")
  const page = await browser.newPage()
  await page.goto(server.url.toString())
  expect(
    await page.evaluate(async (name) => {
      const { openWorkspace } = await import("/index.js")
      const first = await openWorkspace({ name })
      const second = await openWorkspace({ name })
      const before = first.getSnapshot()
      const revisions: number[] = []
      const unsubscribe = first.subscribe(() => revisions.push(first.getSnapshot()))
      await Promise.all([first.writeFile("/first", "one"), second.writeFile("/second", "two")])
      const values = [await first.readText("/first"), await first.readText("/second")]
      const after = first.getSnapshot()
      unsubscribe()
      const count = revisions.length
      await first.writeFile("/third", "three")
      const result = {
        values,
        advanced: after > before,
        notified: count > 0,
        unsubscribed: revisions.length === count,
        bytes: Array.from(await first.readBytes("/first")),
      }
      first.close()
      second.close()
      return result
    }, `opfs-fs-${crypto.randomUUID()}`),
  ).toEqual({ values: ["one", "two"], advanced: true, notified: true, unsubscribed: true, bytes: [111, 110, 101] })
  await page.close()
})

test("recovers the previous generation with its content after metadata corruption", async () => {
  if (!browser || !server) throw new Error("Browser test setup failed.")
  const page = await browser.newPage()
  await page.goto(server.url.toString())
  expect(
    await page.evaluate(async (name) => {
      const { openWorkspace } = await import("/index.js")
      const fs = await openWorkspace({ name })
      await fs.writeFile("/note", "previous")
      await fs.writeFile("/note", "latest")
      const generation = fs.getSnapshot()
      fs.close()
      const opfs = await navigator.storage.getDirectory()
      const directory = await (
        await (await opfs.getDirectoryHandle("kucukkanat-opfs-fs")).getDirectoryHandle("workspaces")
      ).getDirectoryHandle(name)
      const generations = await directory.getDirectoryHandle("generations")
      const writer = await (await generations.getFileHandle(`${generation}.json`)).createWritable()
      await writer.write("corrupted")
      await writer.close()
      const events: string[] = []
      const recovered = await openWorkspace({ name, onDiagnostic: (event) => events.push(event.type) })
      const value = await recovered.readFile("/note")
      const repaired = recovered.getSnapshot() === generation - 1
      recovered.close()
      return { value, repaired, events }
    }, `opfs-fs-${crypto.randomUUID()}`),
  ).toEqual({ value: "previous", repaired: true, events: ["recovery"] })
  await page.close()
})

test("reports cleanup failure without rejecting a committed write", async () => {
  if (!browser || !server) throw new Error("Browser test setup failed.")
  const page = await browser.newPage()
  await page.goto(server.url.toString())
  expect(
    await page.evaluate(async (name) => {
      const { openWorkspace } = await import("/index.js")
      const events: string[] = []
      const fs = await openWorkspace({ name, onDiagnostic: (event) => events.push(event.type) })
      const opfs = await navigator.storage.getDirectory()
      const directory = await (
        await (await opfs.getDirectoryHandle("kucukkanat-opfs-fs")).getDirectoryHandle("workspaces")
      ).getDirectoryHandle(name)
      const objects = await directory.getDirectoryHandle("objects")
      // Real malformed storage entry: non-recursive GC cannot remove a nonempty directory.
      const garbage = await objects.getDirectoryHandle("unexpected-directory", { create: true })
      await garbage.getFileHandle("keep", { create: true })
      await fs.writeFile("/note", "committed")
      const value = await fs.readFile("/note")
      fs.close()
      return { value, events }
    }, `opfs-fs-${crypto.randomUUID()}`),
  ).toEqual({ value: "committed", events: ["cleanup-error"] })
  await page.close()
})

test("serializes concurrent transaction operations and drains started work", async () => {
  if (!browser || !server) throw new Error("Browser test setup failed.")
  const page = await browser.newPage()
  await page.goto(server.url.toString())
  expect(
    await page.evaluate(async (name) => {
      const { openWorkspace } = await import("/index.js")
      const fs = await openWorkspace({ name })
      await fs.writeFile("/log", "")
      await fs.transaction(async (tx) => {
        await Promise.all([tx.appendFile("/log", "one"), tx.appendFile("/log", "two"), tx.appendFile("/log", "three")])
        void tx.writeFile("/started", "drained before commit")
      })
      let failed = false
      try {
        await fs.transaction(async (tx) => {
          void tx.writeFile("/rolled-back", "never publish")
          void tx.readFile("/missing")
        })
      } catch {
        failed = true
      }
      const result = {
        log: await fs.readFile("/log"),
        started: await fs.readFile("/started"),
        failed,
        rolledBack: !(await fs.exists("/rolled-back")),
      }
      fs.close()
      return result
    }, `opfs-fs-${crypto.randomUUID()}`),
  ).toEqual({ log: "onetwothree", started: "drained before commit", failed: true, rolledBack: true })
  await page.close()
})

test("subscriber exceptions and subscriber closure cannot reject a published commit", async () => {
  if (!browser || !server) throw new Error("Browser test setup failed.")
  const page = await browser.newPage()
  await page.goto(server.url.toString())
  expect(
    await page.evaluate(async (name) => {
      const { openWorkspace } = await import("/index.js")
      const fs = await openWorkspace({ name })
      fs.subscribe(() => {
        throw new Error("subscriber failure")
      })
      fs.subscribe(() => fs.close())
      await fs.writeFile("/note", "published")
      const reopened = await openWorkspace({ name })
      const value = await reopened.readFile("/note")
      reopened.close()
      return value
    }, `opfs-fs-${crypto.randomUUID()}`),
  ).toBe("published")
  await page.close()
})

test("imports forward hardlink chains and atomically rejects unresolved or escaping links", async () => {
  if (!browser || !server) throw new Error("Browser test setup failed.")
  const page = await browser.newPage()
  await page.goto(server.url.toString())
  expect(
    await page.evaluate(async (name) => {
      const { openWorkspace, OpfsFsError } = await import("/index.js")
      const { encodeTar } = await import("/tar.js")
      const fs = await openWorkspace({ name, root: "/workspace" })
      const metadata = { data: new Uint8Array(), mode: 0o640, mtime: new Date(0) }
      await fs.importArchive(
        encodeTar([
          { ...metadata, path: "first", type: "hardlink", linkTarget: "second" },
          { ...metadata, path: "second", type: "hardlink", linkTarget: "target" },
          { ...metadata, path: "target", type: "file", data: new TextEncoder().encode("linked") },
        ]),
      )
      await fs.appendFile("/workspace/first", "!")
      const errors: string[] = []
      for (const entries of [
        [
          { ...metadata, path: "unpublished", type: "file" as const },
          { ...metadata, path: "cycle-a", type: "hardlink" as const, linkTarget: "cycle-b" },
          { ...metadata, path: "cycle-b", type: "hardlink" as const, linkTarget: "cycle-a" },
        ],
        [{ ...metadata, path: "escape", type: "hardlink" as const, linkTarget: "../target" }],
      ]) {
        try {
          await fs.importArchive(encodeTar(entries))
        } catch (error) {
          if (error instanceof OpfsFsError) errors.push(error.code)
        }
      }
      await fs.writeFile("/workspace/ascii", "é", "ascii")
      const result = {
        first: await fs.readFile("/workspace/first"),
        target: await fs.readFile("/workspace/target"),
        errors,
        rolledBack: !(await fs.exists("/workspace/unpublished")),
        ascii: Array.from(await fs.readFileBuffer("/workspace/ascii")),
      }
      fs.close()
      return result
    }, `opfs-fs-${crypto.randomUUID()}`),
  ).toEqual({ first: "linked!", target: "linked!", errors: ["ENOENT", "EPERM"], rolledBack: true, ascii: [233] })
  await page.close()
})

test("requires an existing directory when reopening with a different archive root", async () => {
  if (!browser || !server) throw new Error("Browser test setup failed.")
  const page = await browser.newPage()
  await page.goto(server.url.toString())
  expect(
    await page.evaluate(async (name) => {
      const { openWorkspace, OpfsFsError } = await import("/index.js")
      const fs = await openWorkspace({ name, root: "/workspace" })
      await fs.writeFile("/workspace/file", "data")
      const errors: string[] = []
      for (const root of ["/missing", "/workspace/file"]) {
        try {
          ;(await openWorkspace({ name, root })).close()
        } catch (error) {
          if (error instanceof OpfsFsError) errors.push(error.code)
        }
      }
      await fs.mkdir("/other")
      const other = await openWorkspace({ name, root: "/other" })
      const result = { errors, root: other.root, existing: await other.readFile("/workspace/file") }
      fs.close()
      other.close()
      return result
    }, `opfs-fs-${crypto.randomUUID()}`),
  ).toEqual({ errors: ["ENOENT", "ENOTDIR"], root: "/other", existing: "data" })
  await page.close()
})

test("does not initialize over existing data when all recoverable metadata is missing", async () => {
  if (!browser || !server) throw new Error("Browser test setup failed.")
  const page = await browser.newPage()
  await page.goto(server.url.toString())
  expect(
    await page.evaluate(async (name) => {
      const { openWorkspace, OpfsFsError } = await import("/index.js")
      const fs = await openWorkspace({ name })
      await fs.writeFile("/precious", "preserve content")
      fs.close()
      const opfs = await navigator.storage.getDirectory()
      const directory = await (
        await (await opfs.getDirectoryHandle("kucukkanat-opfs-fs")).getDirectoryHandle("workspaces")
      ).getDirectoryHandle(name)
      const generations = await directory.getDirectoryHandle("generations")
      const names: string[] = []
      for await (const [entry] of generations) names.push(entry)
      for (const entry of names) await generations.removeEntry(entry)
      const errors: string[] = []
      try {
        ;(await openWorkspace({ name })).close()
      } catch (error) {
        if (error instanceof OpfsFsError) errors.push(error.code)
      }
      await directory.removeEntry("current.json")
      try {
        ;(await openWorkspace({ name })).close()
      } catch (error) {
        if (error instanceof OpfsFsError) errors.push(error.code)
      }
      const objects = await directory.getDirectoryHandle("objects")
      let preserved = 0
      for await (const _entry of objects) preserved += 1
      let newGenerations = 0
      for await (const _entry of generations) newGenerations += 1
      return { errors, preserved, newGenerations }
    }, `opfs-fs-${crypto.randomUUID()}`),
  ).toEqual({ errors: ["CORRUPT_WORKSPACE", "CORRUPT_WORKSPACE"], preserved: 1, newGenerations: 0 })
  await page.close()
})
