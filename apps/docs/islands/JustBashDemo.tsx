import { useEffect, useRef, useState } from "react"
import { Bash } from "just-bash/browser"
import { openWorkspace, type OpfsWorkspace } from "@kucukkanat/opfs-fs"
import { createJustBashFileSystem } from "@kucukkanat/opfs-fs/just-bash"
import { demoWorkspaceName, formatError } from "./shared"

export const client = "only"

export default function JustBashDemo() {
  const [bash, setBash] = useState<Bash | null>(null)
  const [workspace, setWorkspace] = useState<OpfsWorkspace | null>(null)
  const [output, setOutput] = useState("Opening durable shell…")
  const workspaceRef = useRef<OpfsWorkspace | null>(null)

  useEffect(() => {
    let active = true
    void openWorkspace({ name: demoWorkspaceName("just-bash"), root: "/workspace" }).then(
      (opened) => {
        if (!active) { opened.close(); return }
        const shell = new Bash({ fs: createJustBashFileSystem(opened), cwd: "/workspace", executionLimitProfile: "hardened" })
        workspaceRef.current = opened
        setWorkspace(opened)
        setBash(shell)
        setOutput("Ready. Run the command to write, list, and read a durable file.")
      },
      (error: unknown) => { if (active) setOutput(formatError(error)) },
    )
    return () => { active = false; workspaceRef.current?.close() }
  }, [])

  const run = async (): Promise<void> => {
    if (!bash) return
    try {
      const result = await bash.exec("printf 'saved by just-bash\\n' > note.txt; ls; cat note.txt")
      setOutput(`${result.stdout}${result.stderr}` || "Command completed.")
    } catch (error) { setOutput(formatError(error)) }
  }

  return <section data-testid="just-bash-demo">
    <p><button data-testid="just-bash-demo-run" disabled={!bash} onClick={() => { void run() }}>Run durable shell command</button></p>
    <pre data-testid="just-bash-demo-output"><code>{output}</code></pre>
  </section>
}
