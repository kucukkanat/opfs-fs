import { normalizePath } from "./path.js"
import type { WorkspaceFileSystem } from "./types.js"

/** libfx checkpoints are opaque; this adapter does not import or own the agent runtime. */
export type CheckpointSource = Readonly<{ checkpoint: () => Promise<Uint8Array> }>
export type FxCheckpointStore = Readonly<{
  load: () => Promise<Uint8Array | undefined>
  save: (agent: CheckpointSource) => Promise<void>
}>

/** The parent directory must exist. Save only while the agent is idle. */
export const createFxCheckpointStore = (
  filesystem: Pick<WorkspaceFileSystem, "readFileBuffer" | "writeFile">,
  path: string,
): FxCheckpointStore => {
  const checkpointPath = normalizePath(path)
  return {
    async load() {
      try {
        return await filesystem.readFileBuffer(checkpointPath)
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
        throw error
      }
    },
    async save(agent) {
      await filesystem.writeFile(checkpointPath, await agent.checkpoint())
    },
  }
}
