import { useEffect, useRef } from "react"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { attachJustBashTerminal, type AttachedJustBashTerminal } from "@kucukkanat/opfs-fs/just-bash"
import { demoWorkspaceName, formatError } from "./shared"

export const client = "only"

export default function XtermDemo() {
  const container = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const target = container.current
    if (!target) return
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      rows: 18,
      theme: { background: "#272822", foreground: "#f8f8f2" },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(target)
    fit.fit()
    terminal.focus()
    const resized = new ResizeObserver(() => fit.fit())
    resized.observe(target)

    let disposed = false
    let shell: AttachedJustBashTerminal | undefined
    terminal.write("Opening durable workspace…\r\n")
    void attachJustBashTerminal({
      terminal: { write: terminal.write.bind(terminal), onData: terminal.onData.bind(terminal) },
      workspace: { name: demoWorkspaceName("xterm"), root: "/workspace" },
      executionLimitProfile: "hardened",
      banner: "opfs-fs + just-bash + xterm.js\nTry: help, pwd, ls, cat welcome.txt, or printf hello > note.txt",
      initialize: async ({ workspace }) => workspace.writeFile("/workspace/welcome.txt", "This file lives in OPFS.\n"),
    }).then(
      (attached) => {
        shell = attached
        if (disposed) shell.dispose()
      },
      (error: unknown) => terminal.write(`Unable to open OPFS: ${formatError(error)}\r\n`),
    )

    return () => {
      disposed = true
      resized.disconnect()
      shell?.dispose()
      terminal.dispose()
    }
  }, [])

  return <div data-testid="xterm-demo" ref={container} style={{ minHeight: 360 }} />
}
