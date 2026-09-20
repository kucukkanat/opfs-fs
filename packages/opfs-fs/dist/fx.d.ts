import type { WorkspaceFileSystem } from "./types.js";
/** libfx checkpoints are opaque; this adapter does not import or own the agent runtime. */
export type CheckpointSource = Readonly<{
    checkpoint: () => Promise<Uint8Array>;
}>;
export type FxCheckpointStore = Readonly<{
    load: () => Promise<Uint8Array | undefined>;
    save: (agent: CheckpointSource) => Promise<void>;
}>;
/** The parent directory must exist. Save only while the agent is idle. */
export declare const createFxCheckpointStore: (filesystem: Pick<WorkspaceFileSystem, "readFileBuffer" | "writeFile">, path: string) => FxCheckpointStore;
//# sourceMappingURL=fx.d.ts.map