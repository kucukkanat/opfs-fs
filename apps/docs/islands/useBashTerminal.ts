import { installBrowserBuffer } from "@kucukkanat/opfs-fs/browser-zlib"
import { useCallback, useRef } from "react"
import { attachJustBashTerminal, type AttachedJustBashTerminal, type TerminalPort } from "@kucukkanat/opfs-fs/just-bash"
import { demoWorkspaceName, formatError } from "./shared"

type BashTerminalOptions = Readonly<{
  demo: string
  renderer: string
  write: (value: string) => void
}>

/** A generation owns its renderer callbacks, including while OPFS is opening. */
export const useBashTerminal = ({ demo, renderer, write }: BashTerminalOptions) => {
  const writer = useRef(write)
  writer.current = write
  const listener = useRef<(data: string) => void>(() => {})
  const attached = useRef<AttachedJustBashTerminal | null>(null)
  const generation = useRef(0)
  const pending = useRef(false)

  const initialize = useCallback(async (): Promise<void> => {
    if (attached.current || pending.current) return
    installBrowserBuffer()
    pending.current = true
    const current = ++generation.current
    const terminal: TerminalPort = {
      write: (value) => {
        if (current === generation.current) writer.current(value)
      },
      onData: (onData) => {
        if (current === generation.current) listener.current = onData
        return {
          dispose: () => {
            if (listener.current === onData) listener.current = () => {}
          },
        }
      },
    }
    terminal.write("Opening durable workspace…\r\n")
    try {
      const session = await attachJustBashTerminal({
        terminal,
        workspace: { name: demoWorkspaceName(demo), root: "/workspace" },
        executionLimitProfile: "hardened",
        banner: `opfs-fs + just-bash + ${renderer}\nTry: help, pwd, ls, cat welcome.txt, or printf hello > note.txt`,
        initialize: async ({ workspace }) => {
          if (!(await workspace.exists("/workspace/welcome.txt"))) {
            await workspace.writeFile("/workspace/welcome.txt", "This file lives in OPFS.\n")
          }
        },
      })
      if (current === generation.current) attached.current = session
      else await session.dispose()
    } catch (error) {
      if (current === generation.current) terminal.write(`Unable to open OPFS: ${formatError(error)}\r\n`)
      else console.error("OPFS terminal cleanup failed", error)
    } finally {
      if (current === generation.current) pending.current = false
    }
  }, [demo, renderer])

  const onData = useCallback((data: string): void => listener.current(data), [])
  const close = useCallback(() => {
    ++generation.current
    pending.current = false
    listener.current = () => {}
    const session = attached.current
    attached.current = null
    if (session)
      void Promise.resolve(session.dispose()).catch((error: unknown) =>
        console.error("OPFS terminal cleanup failed", error),
      )
  }, [])

  return { close, initialize, onData }
}
