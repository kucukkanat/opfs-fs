import { openWorkspace } from "@kucukkanat/opfs-fs"
import { createFxCheckpointStore } from "@kucukkanat/opfs-fs/fx"
import { createFxAgent, supportsJspi } from "libfx/browser"

const element = <ElementType extends Element>(
  selector: string,
  elementType: { new (...args: never[]): ElementType },
): ElementType => {
  const value = document.querySelector(selector)
  if (!(value instanceof elementType)) throw new Error(`Missing element: ${selector}`)
  return value
}
const content = element("#content", HTMLTextAreaElement)
const status = element("#status", HTMLOutputElement)
const save = element("#save", HTMLButtonElement)
const load = element("#load", HTMLButtonElement)
const checkpoint = element("#checkpoint", HTMLButtonElement)

try {
  const workspace = await openWorkspace({ name: "browser-agent-example", root: "/workspace" })
  const store = createFxCheckpointStore(workspace, "/workspace/agent.checkpoint")
  const buttons = [save, load, checkpoint]
  const perform = async (action: () => Promise<string>): Promise<void> => {
    for (const button of buttons) button.disabled = true
    try {
      status.value = await action()
    } catch (error) {
      status.value = error instanceof Error ? error.message : String(error)
    } finally {
      for (const button of buttons) button.disabled = false
    }
  }
  save.addEventListener("click", () => {
    void perform(async () => {
      await workspace.writeFile("/workspace/note.txt", content.value)
      return "Saved to OPFS. Reload this page, then restore the file."
    })
  })
  load.addEventListener("click", () => {
    void perform(async () => {
      content.value = await workspace.readFile("/workspace/note.txt")
      return "Restored file from OPFS."
    })
  })
  checkpoint.addEventListener("click", () => {
    void perform(async () => {
      if (!supportsJspi())
        throw new Error(
          "This fx example requires WebAssembly JSPI. Use a current Chrome or another JSPI-capable browser.",
        )
      // libfx validates a nonempty credential at creation; no prompt means no model request.
      const options = { apiKey: "checkpoint-example-no-model-request", wasm: "/fx-core.wasm" }
      const agent = await createFxAgent(options)
      try {
        await store.save(agent)
      } finally {
        await agent.close()
      }
      const bytes = await store.load()
      if (!bytes) throw new Error("Saved checkpoint is missing")
      const restored = await createFxAgent({ ...options, checkpoint: bytes })
      try {
        await restored.checkpoint()
      } finally {
        await restored.close()
      }
      return `Saved and restored ${bytes.length} checkpoint bytes using the real fx WebAssembly runtime.`
    })
  })
  window.addEventListener("pagehide", () => workspace.close(), { once: true })
  for (const button of buttons) button.disabled = false
  status.value = "Workspace ready."
} catch (error) {
  status.value = error instanceof Error ? error.message : String(error)
}
