import { expect, test } from "bun:test"
import { chromium } from "playwright-core"
import { startExample } from "../server.js"

test("consumer example persists files and restores a real fx checkpoint", async () => {
  const server = await startExample(0)
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  })
  const page = await browser.newPage()
  const externalRequests: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== server.url.origin) externalRequests.push(request.url())
  })
  try {
    await page.goto(server.url.toString())
    await page.getByLabel("/workspace/note.txt").fill("Survives a browser reload")
    await page.getByRole("button", { name: "Save file", exact: true }).click()
    await page.getByRole("status").filter({ hasText: "Saved to OPFS" }).waitFor()
    await page.reload()
    await page.getByRole("button", { name: "Restore file", exact: true }).click()
    await page.getByRole("status").filter({ hasText: "Restored file" }).waitFor()
    expect(await page.getByLabel("/workspace/note.txt").inputValue()).toBe("Survives a browser reload")
    await page.getByRole("button", { name: "Save and restore checkpoint", exact: true }).click()
    await page.getByRole("status").filter({ hasText: "checkpoint bytes using the real fx" }).waitFor()
    expect(externalRequests).toEqual([])
  } finally {
    await browser.close()
    server.stop(true)
  }
}, 20_000)
