import { useEffect, useState } from "react"
import { openWorkspace, type OpfsWorkspace } from "@kucukkanat/opfs-fs"
import { demoWorkspaceName, formatError } from "./shared"

export const client = "only"
const path = "/workspace/hello.txt"
const starter = "Hello from a persistent browser workspace.\n"
const buttonStyle = { border: "1px solid currentColor", borderRadius: 6, padding: "8px 14px", cursor: "pointer" }

export default function WorkspaceDemo() {
  const [workspace, setWorkspace] = useState<OpfsWorkspace | null>(null)
  const [content, setContent] = useState(starter)
  const [status, setStatus] = useState("Opening OPFS workspace…")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    let opened: OpfsWorkspace | undefined
    const restore = async (): Promise<void> => {
      try {
        opened = await openWorkspace({ name: demoWorkspaceName("workspace"), root: "/workspace" })
        if (!active) {
          opened.close()
          return
        }
        const saved = await opened.exists(path)
        const text = saved ? await opened.readFile(path) : starter
        if (!active) return
        setWorkspace(opened)
        setContent(text)
        setStatus(
          saved
            ? "Restored hello.txt from OPFS. Your saved text survived reload."
            : "Ready. Edit the text, save, then reload this page.",
        )
      } catch (error) {
        opened?.close()
        if (active) setStatus(formatError(error))
      }
    }
    void restore()
    return () => {
      active = false
      opened?.close()
    }
  }, [])

  const write = async (): Promise<void> => {
    if (!workspace || busy) return
    setBusy(true)
    try {
      await workspace.writeFile(path, content)
      setStatus("Saved hello.txt to OPFS. Reload this page to restore it.")
    } catch (error) {
      setStatus(formatError(error))
    } finally {
      setBusy(false)
    }
  }

  const reset = async (): Promise<void> => {
    if (!workspace || busy || !window.confirm("Reset this demo workspace? This deletes its OPFS files.")) return
    setBusy(true)
    try {
      await workspace.reset()
      setContent(starter)
      setStatus("Workspace reset. The starter text has not been saved.")
    } catch (error) {
      setStatus(formatError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-testid="workspace-demo" aria-label="Persistent file editor">
      <p>
        <label htmlFor="workspace-content">/workspace/hello.txt</label>
      </p>
      <textarea
        id="workspace-content"
        data-testid="workspace-demo-content"
        value={content}
        disabled={!workspace || busy}
        onChange={(event) => setContent(event.target.value)}
        rows={5}
        spellCheck={false}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: 12,
          border: "1px solid currentColor",
          borderRadius: 6,
          fontFamily: "monospace",
        }}
      />
      <p style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          style={buttonStyle}
          data-testid="workspace-demo-write"
          disabled={!workspace || busy}
          onClick={() => {
            void write()
          }}
        >
          Save hello.txt
        </button>
        <button
          type="button"
          style={buttonStyle}
          data-testid="workspace-demo-reset"
          disabled={!workspace || busy}
          onClick={() => {
            void reset()
          }}
        >
          Reset workspace
        </button>
      </p>
      <output aria-live="polite" data-testid="workspace-demo-status">
        {status}
      </output>
    </section>
  )
}
