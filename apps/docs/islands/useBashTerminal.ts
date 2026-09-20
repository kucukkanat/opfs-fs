import { useCallback, useRef } from "react"
import { Bash } from "just-bash/browser"
import { openWorkspace, type OpfsWorkspace } from "@kucukkanat/opfs-fs"
import { createJustBashFileSystem, createJustBashTerminalSession, type JustBashTerminalSession } from "@kucukkanat/opfs-fs/just-bash"
import { demoWorkspaceName, formatError } from "./shared"

type BashTerminalOptions = Readonly<{
  demo: string
  renderer: string
  write: (value: string) => void
}>

/** Connects a documentation renderer to the public, renderer-neutral session adapter. */
export const useBashTerminal = ({ demo, renderer, write }: BashTerminalOptions) => {
  const workspace = useRef<OpfsWorkspace | null>(null)
  const session = useRef<JustBashTerminalSession | null>(null)

  const initialize = useCallback(async (): Promise<void> => {
    if (session.current) return
    write("Opening durable workspace…\r\n")
    try {
      const opened = await openWorkspace({ name: demoWorkspaceName(demo), root: "/workspace" })
      workspace.current = opened
      const bash = new Bash({ fs: createJustBashFileSystem(opened), cwd: "/workspace", executionLimitProfile: "hardened" })
      session.current = createJustBashTerminalSession(bash, { cwd: "/workspace" })
      await opened.writeFile("/workspace/welcome.txt", "This file lives in OPFS.\n")
      write(`opfs-fs + just-bash + ${renderer}\r\nTry: help, pwd, ls, cat welcome.txt, or printf hello > note.txt\r\n`)
      session.current.writePrompt(write)
    } catch (error) {
      write(`Unable to open OPFS: ${formatError(error)}\r\n`)
    }
  }, [demo, renderer, write])

  const onData = useCallback((data: string): void => session.current?.handleInput(data, write), [write])

  const close = useCallback(() => {
    workspace.current?.close()
    workspace.current = null
    session.current = null
  }, [])

  return { close, initialize, onData }
}
