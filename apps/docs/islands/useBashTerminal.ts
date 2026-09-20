import { useCallback, useRef } from "react"
import { Bash } from "just-bash/browser"
import { openWorkspace, type OpfsWorkspace } from "@kucukkanat/opfs-fs"
import { createJustBashFileSystem } from "@kucukkanat/opfs-fs/just-bash"
import { demoWorkspaceName, formatError } from "./shared"

type BashTerminalOptions = Readonly<{
  demo: string
  renderer: string
  write: (value: string) => void
}>

/** Keeps shell state renderer-independent; wterm and xterm only provide input and output. */
export const useBashTerminal = ({ demo, renderer, write }: BashTerminalOptions) => {
  const shell = useRef<Bash | null>(null)
  const workspace = useRef<OpfsWorkspace | null>(null)
  const cwd = useRef("/workspace")
  const input = useRef("")
  const history = useRef<string[]>([])
  const historyIndex = useRef(-1)
  const escapeSequence = useRef("")
  const execution = useRef(Promise.resolve())

  const printPrompt = useCallback(() => write(`opfs:${cwd.current}$ `), [write])
  const replaceInput = useCallback((value: string) => {
    input.current = value
    write(`\r\x1b[2Kopfs:${cwd.current}$ ${value}`)
  }, [write])

  const initialize = useCallback(async (): Promise<void> => {
    if (shell.current) return
    write("Opening durable workspace…\r\n")
    try {
      const opened = await openWorkspace({ name: demoWorkspaceName(demo), root: "/workspace" })
      workspace.current = opened
      shell.current = new Bash({ fs: createJustBashFileSystem(opened), cwd: "/workspace", executionLimitProfile: "hardened" })
      await opened.writeFile("/workspace/welcome.txt", "This file lives in OPFS.\n")
      write(`opfs-fs + just-bash + ${renderer}\r\nTry: help, pwd, ls, cat welcome.txt, or printf hello > note.txt\r\n`)
      printPrompt()
    } catch (error) {
      write(`Unable to open OPFS: ${formatError(error)}\r\n`)
    }
  }, [demo, printPrompt, renderer, write])

  const run = useCallback(async (command: string): Promise<void> => {
    const activeShell = shell.current
    if (!activeShell) return
    // Bash.exec scopes cwd to one invocation; an interactive terminal carries standalone cd across commands.
    const standaloneCd = /^cd(?:\s+(?:-L|-P))?(?:\s+[^;&|]+)?\s*$/.test(command)
    const result = await activeShell.exec(standaloneCd ? `${command} && pwd` : command, { cwd: cwd.current })
    let stdout = result.stdout
    if (standaloneCd && result.exitCode === 0) {
      const lines = stdout.replaceAll("\r\n", "\n").split("\n")
      if (lines.at(-1) === "") lines.pop()
      const nextCwd = lines.pop()
      if (nextCwd?.startsWith("/")) {
        cwd.current = nextCwd
        stdout = lines.length === 0 ? "" : `${lines.join("\n")}\n`
      }
    }
    const terminalText = (value: string): string => value.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n")
    if (stdout) write(terminalText(stdout))
    if (result.stderr) write(terminalText(result.stderr))
  }, [write])

  const onData = useCallback((data: string) => {
    for (const character of data) {
      if (escapeSequence.current) {
        escapeSequence.current += character
        if (escapeSequence.current === "\u001b[A") {
          const next = historyIndex.current < 0 ? history.current.length - 1 : Math.max(0, historyIndex.current - 1)
          if (next >= 0) {
            historyIndex.current = next
            replaceInput(history.current[next] ?? "")
          }
          escapeSequence.current = ""
        } else if (escapeSequence.current === "\u001b[B") {
          const next = historyIndex.current + 1
          historyIndex.current = next >= history.current.length ? -1 : next
          replaceInput(historyIndex.current < 0 ? "" : history.current[historyIndex.current] ?? "")
          escapeSequence.current = ""
        } else if (escapeSequence.current.length > 2 && /[A-Za-z~]/.test(character)) {
          escapeSequence.current = ""
        }
        continue
      }
      if (character === "\u001b") {
        escapeSequence.current = character
        continue
      }
      if (character === "\r" || character === "\n") {
        const command = input.current
        input.current = ""
        if (command.trim() && history.current.at(-1) !== command) history.current.push(command)
        historyIndex.current = -1
        write("\r\n")
        execution.current = execution.current
          .then(() => run(command))
          .catch((error: unknown) => write(`${formatError(error)}\r\n`))
          .finally(printPrompt)
      } else if (character === "\u007f") {
        if (input.current) {
          input.current = input.current.slice(0, -1)
          historyIndex.current = -1
          write("\b \b")
        }
      } else if (character === "\u0003") {
        input.current = ""
        historyIndex.current = -1
        write("^C\r\n")
        printPrompt()
      } else if (character >= " ") {
        input.current += character
        historyIndex.current = -1
        write(character)
      }
    }
  }, [printPrompt, replaceInput, run, write])

  const close = useCallback(() => {
    workspace.current?.close()
    workspace.current = null
    shell.current = null
  }, [])

  return { close, initialize, onData }
}
