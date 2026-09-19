import { useCallback, useEffect, useRef } from "react"
import { Terminal, useTerminal } from "@wterm/react"
import "@wterm/react/css"
import { Bash } from "just-bash/browser"
import { openWorkspace, type OpfsWorkspace } from "@kucukkanat/opfs-fs"
import { createJustBashFileSystem } from "@kucukkanat/opfs-fs/just-bash"
import { demoWorkspaceName, formatError } from "./shared"

export const client = "only"

const prompt = "opfs:/workspace$ "

export default function WtermDemo() {
  const { ref, write } = useTerminal()
  const shell = useRef<Bash | null>(null)
  const workspace = useRef<OpfsWorkspace | null>(null)
  const input = useRef("")
  const busy = useRef(false)

  const printPrompt = useCallback(() => write(prompt), [write])

  const ready = useCallback(() => {
    if (shell.current) return
    void openWorkspace({ name: demoWorkspaceName("wterm"), root: "/workspace" }).then(
      (opened) => {
        workspace.current = opened
        shell.current = new Bash({ fs: createJustBashFileSystem(opened), cwd: "/workspace", executionLimitProfile: "hardened" })
        void opened.writeFile("/workspace/welcome.txt", "This file lives in OPFS.\\n").then(() => {
          write("opfs-fs + just-bash + wterm\\r\\nTry: help, pwd, ls, cat welcome.txt, or printf hello > note.txt\\r\\n")
          printPrompt()
        })
      },
      (error: unknown) => write(`Unable to open OPFS: ${formatError(error)}\\r\\n`),
    )
  }, [printPrompt, write])

  const run = useCallback(async (command: string): Promise<void> => {
    const activeShell = shell.current
    if (!activeShell) return
    const result = await activeShell.exec(command)
    if (result.stdout) write(result.stdout.replaceAll("\n", "\r\n"))
    if (result.stderr) write(result.stderr.replaceAll("\n", "\r\n"))
  }, [write])

  const onData = useCallback((data: string) => {
    if (busy.current) return
    for (const character of data) {
      if (character === "\r" || character === "\n") {
        const command = input.current
        input.current = ""
        write("\r\n")
        busy.current = true
        void run(command).catch((error: unknown) => write(`${formatError(error)}\r\n`)).finally(() => { busy.current = false; printPrompt() })
      } else if (character === "\u007f") {
        if (input.current) { input.current = input.current.slice(0, -1); write("\b \b") }
      } else if (character === "\u0003") {
        input.current = ""
        write("^C\r\n")
        printPrompt()
      } else if (character >= " ") {
        input.current += character
        write(character)
      }
    }
  }, [printPrompt, run, write])

  useEffect(() => () => workspace.current?.close(), [])

  return <div data-testid="wterm-demo" style={{ minHeight: 360 }}><Terminal ref={ref} cols={80} rows={18} autoResize theme="monokai" cursorBlink onReady={ready} onData={onData} /></div>
}
