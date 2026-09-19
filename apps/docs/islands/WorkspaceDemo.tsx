import { useEffect, useRef, useState } from "react"
import { openWorkspace, type OpfsWorkspace } from "@kucukkanat/opfs-fs"
import { demoWorkspaceName, formatError } from "./shared"

export const client = "only"

export default function WorkspaceDemo() {
  const [workspace, setWorkspace] = useState<OpfsWorkspace | null>(null)
  const [status, setStatus] = useState("Opening OPFS workspace…")
  const workspaceRef = useRef<OpfsWorkspace | null>(null)

  useEffect(() => {
    let active = true
    void openWorkspace({ name: demoWorkspaceName("workspace"), root: "/workspace" }).then(
      (opened) => { if (active) { workspaceRef.current = opened; setWorkspace(opened); setStatus("Ready.") } else opened.close() },
      (error: unknown) => { if (active) setStatus(formatError(error)) },
    )
    return () => { active = false; workspaceRef.current?.close() }
  }, [])

  const write = async (): Promise<void> => {
    if (!workspace) return
    try {
      await workspace.writeFile("/workspace/hello.txt", `Written at ${new Date().toISOString()}\n`)
      setStatus(`Saved: ${await workspace.readFile("/workspace/hello.txt")}`)
    } catch (error) { setStatus(formatError(error)) }
  }

  const reset = async (): Promise<void> => {
    if (!workspace || !window.confirm("Reset this demo workspace? This deletes its OPFS files.")) return
    try { await workspace.reset(); setStatus("Workspace reset.") } catch (error) { setStatus(formatError(error)) }
  }

  return <section data-testid="workspace-demo">
    <p><button data-testid="workspace-demo-write" disabled={!workspace} onClick={() => { void write() }}>Write hello.txt</button>{" "}<button data-testid="workspace-demo-reset" disabled={!workspace} onClick={() => { void reset() }}>Reset</button></p>
    <output data-testid="workspace-demo-status">{status}</output>
  </section>
}
