import { useCallback, useEffect } from "react"
import { Terminal, useTerminal } from "@wterm/react"
import "@wterm/react/css"
import { useBashTerminal } from "./useBashTerminal"

export const client = "only"

export default function WtermDemo() {
  const { ref, write } = useTerminal()
  const terminalWrite = useCallback((value: string) => write(value), [write])
  const { close, initialize, onData } = useBashTerminal({ demo: "wterm", renderer: "wterm", write: terminalWrite })

  useEffect(() => close, [close])

  return (
    <div data-testid="wterm-demo" style={{ minHeight: 360 }}>
      <Terminal
        ref={ref}
        cols={80}
        rows={18}
        autoResize
        theme="monokai"
        cursorBlink
        onReady={initialize}
        onData={onData}
      />
    </div>
  )
}
