import { installBrowserBuffer } from "@kucukkanat/opfs-fs/browser-zlib"
import { useCallback, useEffect, useRef, useState } from "react"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { attachJustBashTerminal, type AttachedJustBashTerminal, type TerminalPort } from "@kucukkanat/opfs-fs/just-bash"
import { demoWorkspaceName, formatError } from "./shared"

export const client = "only"

const starter = (workspaceName: string): string => `return attachJustBashTerminal({
  terminal,
  workspace: { name: ${JSON.stringify(workspaceName)}, root: "/workspace" },
  executionLimitProfile: "hardened",
  banner: "opfs-fs + just-bash + xterm.js\\nTry: help, pwd, ls, cat welcome.txt",
  initialize: async ({ workspace }) => {
    await workspace.writeFile(
      "/workspace/welcome.txt",
      "This file lives in OPFS.\\n",
    )
  },
})`

type Snippet = (attach: typeof attachJustBashTerminal, terminal: TerminalPort) => Promise<unknown>

const compile = (source: string): Snippet =>
  Function("attachJustBashTerminal", "terminal", `"use strict"; return (async () => { ${source} })()`) as Snippet

const isAttachedTerminal = (value: unknown): value is AttachedJustBashTerminal =>
  typeof value === "object" && value !== null && "dispose" in value && typeof value.dispose === "function"

export default function XtermPlayground() {
  const [initialSource] = useState(() => starter(demoWorkspaceName("xterm")))
  const [source, setSource] = useState(initialSource)
  const sourceRows = source.split("\n").length
  const host = useRef<HTMLDivElement | null>(null)
  const terminal = useRef<Terminal | null>(null)
  const shell = useRef<AttachedJustBashTerminal | null>(null)
  const execution = useRef(0)

  const run = useCallback(async (nextSource: string): Promise<void> => {
    const instance = terminal.current
    if (!instance) return

    const runId = ++execution.current
    try {
      const previous = shell.current
      shell.current = null
      if (previous) await previous.dispose()
      if (runId !== execution.current) return
      instance.reset()
      instance.write("Running editable snippet…\r\n")

      const result = await compile(nextSource)(attachJustBashTerminal, {
        write: (value) => {
          if (runId === execution.current) instance.write(value)
        },
        onData: (callback) => (runId === execution.current ? instance.onData(callback) : { dispose: () => {} }),
      })
      if (!isAttachedTerminal(result)) throw new Error("The snippet must return attachJustBashTerminal(...).")
      if (runId !== execution.current) {
        await result.dispose()
        return
      }
      shell.current = result
    } catch (error) {
      if (runId === execution.current) instance.write(`Snippet failed: ${formatError(error)}\r\n`)
    }
  }, [])

  useEffect(() => {
    installBrowserBuffer()
    const target = host.current
    if (!target) return

    const instance = new Terminal({
      cursorBlink: true,
      screenReaderMode: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      rows: 18,
      theme: { background: "#272822", foreground: "#f8f8f2" },
    })
    const fit = new FitAddon()
    instance.loadAddon(fit)
    instance.open(target)
    fit.fit()
    instance.focus()
    terminal.current = instance
    const resized = new ResizeObserver(() => fit.fit())
    resized.observe(target)
    void run(initialSource)

    return () => {
      ++execution.current
      resized.disconnect()
      if (shell.current)
        void Promise.resolve(shell.current.dispose()).catch((error: unknown) =>
          console.error("OPFS terminal cleanup failed", error),
        )
      shell.current = null
      terminal.current = null
      instance.dispose()
    }
  }, [initialSource, run])

  return (
    <section data-testid="xterm-playground">
      <p>
        Edit the runnable attachment program, then press <kbd>⌘/Ctrl</kbd> + <kbd>Enter</kbd> or Run. `terminal` and
        `attachJustBashTerminal` are pre-bound by this playground. This is an executable local playground, not a trust
        boundary: run only code you trust.
      </p>
      <textarea
        aria-label="Editable xterm.js example"
        data-testid="xterm-source"
        onChange={(event) => setSource(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault()
            void run(source)
          }
        }}
        rows={sourceRows}
        spellCheck={false}
        style={{
          boxSizing: "border-box",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          padding: 16,
          width: "100%",
        }}
        value={source}
      />
      <p style={{ display: "flex", gap: 12 }}>
        <button
          style={{ padding: "8px 14px", border: "1px solid currentColor", borderRadius: 6 }}
          data-testid="xterm-run"
          onClick={() => void run(source)}
          type="button"
        >
          Run
        </button>{" "}
        <button
          style={{ padding: "8px 14px", border: "1px solid currentColor", borderRadius: 6 }}
          onClick={() => {
            setSource(initialSource)
            void run(initialSource)
          }}
          type="button"
        >
          Reset source
        </button>
      </p>
      <div data-testid="xterm-demo" ref={host} style={{ minHeight: 360 }} />
    </section>
  )
}
