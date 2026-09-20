import { afterAll, beforeAll, expect, test } from "bun:test"
import { chromium, type Browser } from "playwright-core"

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const docs = `${import.meta.dir}/../../dist`
let browser: Browser | undefined
let server: ReturnType<typeof Bun.serve> | undefined

beforeAll(async () => {
  browser = await chromium.launch({ executablePath: chrome, headless: true })
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

afterAll(async () => {
  server?.stop(true)
  await browser?.close()
})

test("emits the interactive wterm documentation page", async () => {
  const page = await Bun.file(`${import.meta.dir}/../../dist/wterm/index.html`).text()
  expect(page).toContain("Build a live browser terminal backed by just-bash and opfs-fs.")
  expect(page).toContain("@wterm/react")
})

test("emits the interactive xterm.js documentation page", async () => {
  const page = await Bun.file(`${import.meta.dir}/../../dist/xterm/index.html`).text()
  expect(page).toContain("Build a durable browser terminal with xterm.js, just-bash, and opfs-fs.")
  expect(page).toContain("@xterm/xterm")
})

test("executes terminal commands and recalls command history", async () => {
  const activeBrowser = browser
  const activeServer = server
  if (!activeBrowser || !activeServer) throw new Error("Browser test setup failed.")
  const context = await activeBrowser.newContext()
  const page = await context.newPage()
  await page.goto(`${activeServer.url}opfs-fs/wterm/`)
  const terminal = page.locator("[data-testid=wterm-demo] textarea")
  await terminal.waitFor({ state: "visible" })
  await page.waitForFunction(() => document.querySelector("[data-testid=wterm-demo]")?.textContent?.includes("opfs-fs + just-bash + wterm"))
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
})

test("executes OPFS-backed commands in xterm.js", async () => {
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
    await page.waitForFunction(() => document.querySelector("[data-testid=xterm-demo]")?.textContent?.includes("opfs-fs + just-bash + xterm.js"))
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
    await source.fill(`return attachJustBashTerminal({
  terminal,
  workspace: { name: "xterm-edited", root: "/workspace" },
  banner: "Edited live snippet",
})`)
    await page.getByTestId("xterm-run").click()
    await page.waitForFunction(() => document.querySelector("[data-testid=xterm-demo]")?.textContent?.includes("Edited live snippet"))
    await context.close()
  } finally {
    await xtermBrowser.close()
  }
}, 15_000)
