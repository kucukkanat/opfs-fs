import { Bash, type BashOptions, type IFileSystem } from "just-bash/browser"
import { openWorkspace, type OpfsWorkspace } from "./workspace.js"
import type { OpenWorkspaceOptions } from "./types.js"

export type TerminalWriter = (value: string) => void
export type JustBashExecution = Awaited<ReturnType<InstanceType<typeof Bash>["exec"]>>

export type JustBashTerminalSession = Readonly<{
  readonly cwd: string
  readonly history: readonly string[]
  execute: (command: string) => Promise<JustBashExecution>
  handleInput: (data: string, write: TerminalWriter) => void
  writePrompt: (write: TerminalWriter) => void
}>

export type TerminalPort = Readonly<{
  write: TerminalWriter
  onData: (listener: (data: string) => void) => Readonly<{ dispose: () => void }>
}>

export type AttachJustBashTerminalOptions = Readonly<{
  terminal: TerminalPort
  workspace: OpenWorkspaceOptions
  banner?: string
  prompt?: string | ((cwd: string) => string)
  executionLimitProfile?: BashOptions["executionLimitProfile"]
  initialize?: (context: Readonly<{ workspace: OpfsWorkspace; bash: Bash; session: JustBashTerminalSession }>) => Promise<void> | void
}>

export type AttachedJustBashTerminal = Readonly<{
  workspace: OpfsWorkspace
  bash: Bash
  session: JustBashTerminalSession
  readonly cwd: string
  execute: JustBashTerminalSession["execute"]
  dispose: () => void
}>

/** Exposes an OPFS workspace through just-bash's filesystem contract. */
export const createJustBashFileSystem = (workspace: OpfsWorkspace): IFileSystem => workspace as unknown as IFileSystem

const terminalText = (value: string): string => value.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n")

/**
 * Adds interactive terminal behavior to a Bash instance without coupling it to
 * a renderer. Pass xterm.js, wterm, or another terminal's input to handleInput.
 */
export const createJustBashTerminalSession = (bash: Bash, options: Readonly<{ cwd?: string; prompt?: string | ((cwd: string) => string) }> = {}): JustBashTerminalSession => {
  let cwd = options.cwd ?? "/"
  let input = ""
  const history: string[] = []
  let historyIndex = -1
  let escapeSequence = ""
  let execution = Promise.resolve()

  const prompt = (): string => typeof options.prompt === "function" ? options.prompt(cwd) : (options.prompt ?? "opfs:{cwd}$ ").replaceAll("{cwd}", cwd)
  const writePrompt = (write: TerminalWriter): void => write(prompt())
  const replaceInput = (value: string, write: TerminalWriter): void => {
    input = value
    write(`\r\x1b[2K${prompt()}${value}`)
  }

  const execute = async (command: string): Promise<JustBashExecution> => {
    // Bash.exec scopes cwd to one invocation; promote only standalone cd to session state.
    const standaloneCd = /^cd(?:\s+(?:-L|-P))?(?:\s+[^;&|]+)?\s*$/.test(command)
    const result = await bash.exec(standaloneCd ? `${command} && pwd` : command, { cwd })
    if (!standaloneCd || result.exitCode !== 0) return result
    const lines = result.stdout.replaceAll("\r\n", "\n").split("\n")
    if (lines.at(-1) === "") lines.pop()
    const nextCwd = lines.pop()
    if (!nextCwd?.startsWith("/")) return result
    cwd = nextCwd
    return { ...result, stdout: lines.length === 0 ? "" : `${lines.join("\n")}\n` }
  }

  const run = async (command: string, write: TerminalWriter): Promise<void> => {
    const result = await execute(command)
    if (result.stdout) write(terminalText(result.stdout))
    if (result.stderr) write(terminalText(result.stderr))
  }

  const handleInput = (data: string, write: TerminalWriter): void => {
    for (const character of data) {
      if (escapeSequence) {
        escapeSequence += character
        if (escapeSequence === "\u001b[A") {
          const next = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1)
          if (next >= 0) {
            historyIndex = next
            replaceInput(history[next] ?? "", write)
          }
          escapeSequence = ""
        } else if (escapeSequence === "\u001b[B") {
          const next = historyIndex + 1
          historyIndex = next >= history.length ? -1 : next
          replaceInput(historyIndex < 0 ? "" : history[historyIndex] ?? "", write)
          escapeSequence = ""
        } else if (escapeSequence.length > 2 && /[A-Za-z~]/.test(character)) {
          escapeSequence = ""
        }
        continue
      }
      if (character === "\u001b") {
        escapeSequence = character
        continue
      }
      if (character === "\r" || character === "\n") {
        const command = input
        input = ""
        if (command.trim() && history.at(-1) !== command) history.push(command)
        historyIndex = -1
        write("\r\n")
        execution = execution
          .then(() => run(command, write))
          .catch((error: unknown) => write(`${error instanceof Error ? error.message : "An unknown error occurred."}\r\n`))
          .finally(() => writePrompt(write))
      } else if (character === "\u007f") {
        if (input) {
          input = input.slice(0, -1)
          historyIndex = -1
          write("\b \b")
        }
      } else if (character === "\u0003") {
        input = ""
        historyIndex = -1
        write("^C\r\n")
        writePrompt(write)
      } else if (character >= " ") {
        input += character
        historyIndex = -1
        write(character)
      }
    }
  }

  return {
    get cwd(): string { return cwd },
    get history(): readonly string[] { return history.slice() },
    execute,
    handleInput,
    writePrompt,
  }
}

/**
 * Attaches a durable OPFS-backed just-bash session to any terminal exposing
 * write() and onData(). xterm.js and wterm both satisfy this small contract.
 */
export const attachJustBashTerminal = async (options: AttachJustBashTerminalOptions): Promise<AttachedJustBashTerminal> => {
  const workspace = await openWorkspace(options.workspace)
  try {
    const cwd = options.workspace.root ?? "/"
    const bash = new Bash({
      fs: createJustBashFileSystem(workspace),
      cwd,
      ...(options.executionLimitProfile === undefined ? {} : { executionLimitProfile: options.executionLimitProfile }),
    })
    const session = createJustBashTerminalSession(bash, { cwd, ...(options.prompt === undefined ? {} : { prompt: options.prompt }) })
    await options.initialize?.({ workspace, bash, session })
    const subscription = options.terminal.onData((data) => session.handleInput(data, options.terminal.write))
    if (options.banner) options.terminal.write(`${terminalText(options.banner)}${options.banner.endsWith("\n") ? "" : "\r\n"}`)
    session.writePrompt(options.terminal.write)
    let disposed = false
    const dispose = (): void => {
      if (disposed) return
      disposed = true
      subscription.dispose()
      workspace.close()
    }
    return {
      workspace,
      bash,
      session,
      get cwd(): string { return session.cwd },
      execute: session.execute,
      dispose,
    }
  } catch (error) {
    workspace.close()
    throw error
  }
}
