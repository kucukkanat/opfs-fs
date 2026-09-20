import { expect, test } from "bun:test"
import { Bash } from "just-bash/browser"
import { createJustBashTerminalSession } from "../../src/just-bash.js"

const createSession = () => createJustBashTerminalSession(new Bash({ files: { "/work/note": "hello" } }))

test("preserves compound-command cwd while environment remains per execution", async () => {
  const session = createSession()
  expect((await session.execute("cd /work; export SESSION_ONLY=yes; pwd")).stdout).toBe("/work\n")
  expect(session.cwd).toBe("/work")
  expect((await session.execute('pwd; printf "%s" "$SESSION_ONLY"')).stdout).toBe("/work\n")
  expect((await session.execute("cd /; false")).exitCode).toBe(1)
  expect(session.cwd).toBe("/")
  await session.dispose()
})

test("serializes terminal and programmatic commands in one queue", async () => {
  const session = createSession()
  const output: string[] = []
  session.handleInput("cd /work\r", (value) => output.push(value))
  expect((await session.execute("pwd")).stdout).toBe("/work\n")
  expect(output.join("")).toContain("opfs:/work$")
  await session.dispose()
})

test("terminal cwd comes from interpreter state rather than the assignable PWD variable", async () => {
  const session = createSession()
  await session.execute("export PWD=/does-not-exist; pwd")
  expect(session.cwd).toBe("/")
  await session.execute("cd /work; unset PWD; pwd")
  expect(session.cwd).toBe("/work")
  expect((await session.execute("pwd")).stdout).toBe("/work\n")
  await session.execute("(cd /); pwd")
  expect(session.cwd).toBe("/work")
  await session.dispose()
})

test("aborted queued commands do not execute or poison following commands", async () => {
  const session = createSession()
  const controller = new AbortController()
  const aborted = session.execute("cd /work", { signal: controller.signal })
  controller.abort()
  await expect(aborted).rejects.toHaveProperty("name", "AbortError")
  expect((await session.execute("pwd")).stdout).toBe("/\n")
  await session.dispose()
})

test("Ctrl-C cancels queued terminal execution", async () => {
  const session = createSession()
  session.handleInput("cd /work\r\u0003", () => undefined)
  expect((await session.execute("pwd")).stdout).toBe("/\n")
  await session.dispose()
})

test("disposal aborts queued commands and suppresses later renderer callbacks", async () => {
  const session = createSession()
  const output: string[] = []
  session.handleInput("echo should-not-render\r", (value) => output.push(value))
  const before = output.join("")
  await session.dispose()
  session.handleInput("echo ignored\r", (value) => output.push(value))
  session.writePrompt((value) => output.push(value))
  expect(output.join("")).toBe(before)
  await expect(session.execute("pwd")).rejects.toHaveProperty("code", "CLOSED")
  await session.dispose()
})

test("external cancellation interrupts a running shell before later statements", async () => {
  const session = createSession()
  const controller = new AbortController()
  const execution = session.execute("sleep 5; echo should-not-run", { signal: controller.signal })
  const timer = setTimeout(() => controller.abort(), 20)
  try {
    const result = await execution
    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("aborted")
  } finally {
    clearTimeout(timer)
    await session.dispose()
  }
})
