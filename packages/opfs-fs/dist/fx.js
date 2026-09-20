import { normalizePath } from "./path.js";
/** The parent directory must exist. Save only while the agent is idle. */
export const createFxCheckpointStore = (filesystem, path) => {
    const checkpointPath = normalizePath(path);
    return {
        async load() {
            try {
                return await filesystem.readFileBuffer(checkpointPath);
            }
            catch (error) {
                if (error instanceof Error && "code" in error && error.code === "ENOENT")
                    return undefined;
                throw error;
            }
        },
        async save(agent) {
            await filesystem.writeFile(checkpointPath, await agent.checkpoint());
        },
    };
};
//# sourceMappingURL=fx.js.map