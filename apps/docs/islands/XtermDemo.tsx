import { useCallback, useEffect, useRef } from "react"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { useBashTerminal } from "./useBashTerminal"

export const client = "only"

export default function XtermDemo() {
  const container = useRef<HTMLDivElement | null>(null)
  const terminal = useRef<Terminal | null>(null)
  const terminalWrite = useCallback((value: string) => terminal.current?.write(value), [])
  const { close, initialize, onData } = useBashTerminal({ demo: "xterm", renderer: "xterm.js", write: terminalWrite })

  useEffect(() => {
    const target = container.current
    if (!target) return
    const instance = new Terminal({
      cursorBlink: true,
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
    const input = instance.onData(onData)
    const resized = new ResizeObserver(() => fit.fit())
    resized.observe(target)
    void initialize()
    return () => {
      resized.disconnect()
      input.dispose()
      terminal.current = null
      instance.dispose()
      close()
    }
  }, [close, initialize, onData])

  return <div data-testid="xterm-demo" ref={container} style={{ minHeight: 360 }} />
}
