import { useCallback, useRef } from "react"
import { attachJustBashTerminal, type AttachedJustBashTerminal, type TerminalPort } from "@kucukkanat/opfs-fs/just-bash"
import { demoWorkspaceName, formatError } from "./shared"

type BashTerminalOptions = Readonly<{
  demo: string
  renderer: string
  write: (value: string) => void
}>

/** Bridges renderers with prop-based input APIs to the public terminal port. */
export const useBashTerminal = ({ demo, renderer, write }: BashTerminalOptions) => {
  const writer = useRef(write)
  writer.current = write
  const listener = useRef<(data: string) => void>(() => {})
  const attached = useRef<AttachedJustBashTerminal | null>(null)
  const terminal = useRef<TerminalPort>({
    write: (value) => writer.current(value),
    onData: (onData) => {
      listener.current = onData
      return { dispose: () => { listener.current = () => {} } }
    },
  })

  const initialize = useCallback(async (): Promise<void> => {
    if (attached.current) return
    writer.current("Opening durable workspace…\r\n")
    try {
      attached.current = await attachJustBashTerminal({
        terminal: terminal.current,
        workspace: { name: demoWorkspaceName(demo), root: "/workspace" },
        executionLimitProfile: "hardened",
        banner: `opfs-fs + just-bash + ${renderer}\nTry: help, pwd, ls, cat welcome.txt, or printf hello > note.txt`,
        initialize: async ({ workspace }) => workspace.writeFile("/workspace/welcome.txt", "This file lives in OPFS.\n"),
      })
    } catch (error) {
      writer.current(`Unable to open OPFS: ${formatError(error)}\r\n`)
    }
  }, [demo, renderer])

  const onData = useCallback((data: string): void => listener.current(data), [])
  const close = useCallback(() => {
    attached.current?.dispose()
    attached.current = null
  }, [])

  return { close, initialize, onData }
}
