import type { IFileSystem } from "just-bash/browser"
import type { OpfsWorkspace } from "./workspace.js"

/** Exposes an OPFS workspace through just-bash's filesystem contract. */
export const createJustBashFileSystem = (workspace: OpfsWorkspace): IFileSystem => workspace as unknown as IFileSystem
