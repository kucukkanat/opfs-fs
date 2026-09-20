import { afterAll, beforeAll, expect, test } from "bun:test"
import { chromium } from "playwright-core"

const chrome = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const docs = `${import.meta.dir}/../../dist`
let server: ReturnType<typeof Bun.serve> | undefined

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname
      const relativePath = path.startsWith("/opfs-fs/") ? path.slice("/opfs-fs".length) : path
      if (relativePath.includes("..")) return new Response("Not found", { status: 404 })
      const file = Bun.file(`${docs}${relativePath.endsWith("/") ? `${relativePath}index.html` : relativePath}`)
      return new Response(file)
    },
  })
})

afterAll(() => {
  server?.stop(true)
})

test.serial("executes OPFS-backed commands in xterm.js", xtermIntegration, 30_000)

test.serial("executes terminal commands and recalls command history", async () => {
  const activeServer = server
  if (!activeServer) throw new Error("Browser test setup failed.")
  const wtermBrowser = await chromium.launch({ executablePath: chrome, headless: true })
  try {
    const context = await wtermBrowser.newContext()
    const page = await context.newPage()
    await page.goto(`${activeServer.url}opfs-fs/wterm/`)
    const terminal = page.locator("[data-testid=wterm-demo] textarea")
    await terminal.waitFor({ state: "visible" })
    await page.waitForFunction(() =>
      document.querySelector("[data-testid=wterm-demo]")?.textContent?.includes("opfs-fs + just-bash + wterm"),
    )
    await terminal.pressSequentially("echo hello")
    await terminal.press("Enter")
    await page.waitForTimeout(100)
    await terminal.press("ArrowUp")
    await terminal.press("Enter")
    await page.waitForTimeout(100)
    const historyOutput = await page.locator("[data-testid=wterm-demo]").innerText()
    expect(historyOutput.match(/opfs:\/workspace\$ echo hello/g)?.length).toBe(2)
    await terminal.pressSequentially("cat welcome.txt")
    await terminal.press("Enter")
    await page.waitForTimeout(100)
    await terminal.pressSequentially("cd /")
    await terminal.press("Enter")
    await page.waitForTimeout(100)
    await terminal.pressSequentially("pwd")
    await terminal.press("Enter")
    await page.waitForTimeout(300)
    const output = await page.locator("[data-testid=wterm-demo]").innerText()
    expect(output).toContain("hello")
    expect(output).toContain("This file lives in OPFS.")
    expect(output).not.toContain("This file lives in OPFS.\\n")
    expect(output).toMatch(/\n\/\s*\n/)
    await context.close()
  } finally {
    await wtermBrowser.close()
  }
})

async function xtermIntegration(): Promise<void> {
  const activeServer = server
  if (!activeServer) throw new Error("Browser test setup failed.")

  // xterm owns global browser resources. A separate process prevents a prior
  // renderer from retaining OPFS/terminal state across this integration test.
  const xtermBrowser = await chromium.launch({ executablePath: chrome, headless: true })
  try {
    const context = await xtermBrowser.newContext()
    const page = await context.newPage()
    await page.goto(`${activeServer.url}opfs-fs/xterm/`)
    const terminal = page.locator("[data-testid=xterm-demo] textarea")
    await terminal.waitFor({ state: "visible" })
    try {
      await page.waitForFunction(
        () =>
          document.querySelector("[data-testid=xterm-demo]")?.textContent?.includes("opfs-fs + just-bash + xterm.js"),
        undefined,
        { timeout: 10_000 },
      )
    } catch {
      // Headless Chromium occasionally loses the first canvas-backed hydration.
      // A fresh document is the user-visible recovery path, and proves reload safety.
      await page.reload()
      await terminal.waitFor({ state: "visible" })
      await page.waitForFunction(
        () =>
          document.querySelector("[data-testid=xterm-demo]")?.textContent?.includes("opfs-fs + just-bash + xterm.js"),
        undefined,
        { timeout: 10_000 },
      )
    }
    await page.locator("[data-testid=xterm-demo] .xterm").click()
    await terminal.focus()
    await page.waitForTimeout(250)
    await terminal.pressSequentially("echo hello")
    await terminal.press("Enter")
    await page.waitForTimeout(100)
    await terminal.pressSequentially("cat welcome.txt")
    await terminal.press("Enter")
    await page.waitForTimeout(300)
    const output = await page.locator("[data-testid=xterm-demo]").innerText()
    expect(output).toContain("hello")
    expect(output).toContain("This file lives in OPFS.")
    expect(output).not.toContain("This file lives in OPFS.\\n")
    const source = page.locator("[data-testid=xterm-source]")
    expect(await source.getAttribute("rows")).toBe("12")
    await source.fill(`return attachJustBashTerminal({
  terminal,
  workspace: { name: "xterm-edited", root: "/workspace" },
  banner: "Edited live snippet",
})`)
    expect(await source.getAttribute("rows")).toBe("5")
    await page.getByTestId("xterm-run").click()
    await page.waitForFunction(() =>
      document.querySelector("[data-testid=xterm-demo]")?.textContent?.includes("Edited live snippet"),
    )
    await context.close()
  } finally {
    await xtermBrowser.close()
  }
}

test.serial(
  "restores an edited file after reload and honors reset cancellation",
  async () => {
    const activeServer = server
    if (!activeServer) throw new Error("Browser test setup failed.")
    const browser = await chromium.launch({ executablePath: chrome, headless: true })
    try {
      const context = await browser.newContext()
      const page = await context.newPage()
      const errors: string[] = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.goto(`${activeServer.url}opfs-fs/`)
      const editor = page.getByTestId("workspace-demo-content")
      await page.waitForFunction(
        () => document.querySelector<HTMLTextAreaElement>("[data-testid=workspace-demo-content]")?.disabled === false,
      )
      const content = "Persistent browser agent notes\nUnicode: λ 🦊\n"
      await editor.fill(content)
      await page.getByTestId("workspace-demo-write").click()
      await page.waitForFunction(() =>
        document.querySelector("[data-testid=workspace-demo-status]")?.textContent?.startsWith("Saved hello.txt"),
      )
      await page.reload()
      await page.waitForFunction(() =>
        document.querySelector("[data-testid=workspace-demo-status]")?.textContent?.startsWith("Restored hello.txt"),
      )
      expect(await editor.inputValue()).toBe(content)
      page.once("dialog", (dialog) => {
        void dialog.dismiss()
      })
      await page.getByTestId("workspace-demo-reset").click()
      expect(await editor.inputValue()).toBe(content)
      page.once("dialog", (dialog) => {
        void dialog.accept()
      })
      await page.getByTestId("workspace-demo-reset").click()
      await page.waitForFunction(() =>
        document.querySelector("[data-testid=workspace-demo-status]")?.textContent?.startsWith("Workspace reset"),
      )
      await page.reload()
      await page.waitForFunction(() =>
        document.querySelector("[data-testid=workspace-demo-status]")?.textContent?.startsWith("Ready."),
      )
      expect(await editor.inputValue()).not.toBe(content)
      expect(errors).toEqual([])
      await context.close()
    } finally {
      await browser.close()
    }
  },
  30_000,
)

test.serial(
  "disposes a late terminal attachment when a newer run replaces it",
  async () => {
    const activeServer = server
    if (!activeServer) throw new Error("Browser test setup failed.")
    const browser = await chromium.launch({ executablePath: chrome, headless: true })
    try {
      const page = await browser.newPage()
      await page.goto(`${activeServer.url}opfs-fs/xterm/`)
      await page.getByTestId("xterm-source").waitFor()
      await page.waitForFunction(() =>
        document.querySelector("[data-testid=xterm-demo]")?.textContent?.includes("Try: help"),
      )
      await page.getByTestId("xterm-source").fill(`return attachJustBashTerminal({
  terminal,
  workspace: { name: "late-attachment", root: "/workspace" },
  initialize: () => new Promise((resolve) => { window.releaseAttachment = resolve }),
}).then((session) => { window.lateAttachment = session; return session })`)
      await page.getByTestId("xterm-run").click()
      await page.waitForFunction(() => "releaseAttachment" in window)
      await page.getByTestId("xterm-source").fill(`return attachJustBashTerminal({
  terminal,
  workspace: { name: "replacement-attachment", root: "/workspace" },
  banner: "Replacement session ready",
})`)
      await page.getByTestId("xterm-run").click()
      await page.waitForFunction(() =>
        document.querySelector("[data-testid=xterm-demo]")?.textContent?.includes("Replacement session ready"),
      )
      await page.evaluate(() => {
        const harness = window as typeof window & { releaseAttachment?: () => void }
        harness.releaseAttachment?.()
      })
      await page.waitForFunction(() => {
        const harness = window as typeof window & { lateAttachment?: { workspace: { getSnapshot: () => number } } }
        if (!harness.lateAttachment) return false
        try {
          harness.lateAttachment.workspace.getSnapshot()
          return false
        } catch (error) {
          return error instanceof Error && "code" in error && error.code === "CLOSED"
        }
      })
      expect(await page.getByTestId("xterm-demo").innerText()).toContain("Replacement session ready")
    } finally {
      await browser.close()
    }
  },
  30_000,
)
