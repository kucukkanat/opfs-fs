import { Bash, type IFileSystem } from "just-bash/browser";
import type { OpfsWorkspace } from "./workspace.js";
export type TerminalWriter = (value: string) => void;
export type JustBashExecution = Awaited<ReturnType<InstanceType<typeof Bash>["exec"]>>;
export type JustBashTerminalSession = Readonly<{
    readonly cwd: string;
    readonly history: readonly string[];
    execute: (command: string) => Promise<JustBashExecution>;
    handleInput: (data: string, write: TerminalWriter) => void;
    writePrompt: (write: TerminalWriter) => void;
}>;
/** Exposes an OPFS workspace through just-bash's filesystem contract. */
export declare const createJustBashFileSystem: (workspace: OpfsWorkspace) => IFileSystem;
/**
 * Adds interactive terminal behavior to a Bash instance without coupling it to
 * a renderer. Pass xterm.js, wterm, or another terminal's input to handleInput.
 */
export declare const createJustBashTerminalSession: (bash: Bash, options?: Readonly<{
    cwd?: string;
}>) => JustBashTerminalSession;
//# sourceMappingURL=just-bash.d.ts.map