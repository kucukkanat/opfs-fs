import { Bash, type BashOptions, type IFileSystem } from "just-bash/browser";
import { type OpfsWorkspace } from "./workspace.js";
import type { OpenWorkspaceOptions, WorkspaceFileSystem } from "./types.js";
export type TerminalWriter = (value: string) => void;
export type JustBashExecution = Awaited<ReturnType<InstanceType<typeof Bash>["exec"]>>;
export type JustBashTerminalSession = Readonly<{
    readonly cwd: string;
    readonly history: readonly string[];
    execute: (command: string, options?: Readonly<{
        signal?: AbortSignal;
    }>) => Promise<JustBashExecution>;
    dispose: () => Promise<void>;
    handleInput: (data: string, write: TerminalWriter) => void;
    writePrompt: (write: TerminalWriter) => void;
}>;
export type TerminalPort = Readonly<{
    write: TerminalWriter;
    onData: (listener: (data: string) => void) => Readonly<{
        dispose: () => void;
    }>;
}>;
export type AttachJustBashTerminalOptions = Readonly<{
    terminal: TerminalPort;
    workspace: OpenWorkspaceOptions | Readonly<{
        instance: OpfsWorkspace;
        ownership: "borrowed" | "owned";
    }>;
    banner?: string;
    prompt?: string | ((cwd: string) => string);
    executionLimitProfile?: BashOptions["executionLimitProfile"];
    initialize?: (context: Readonly<{
        workspace: OpfsWorkspace;
        bash: Bash;
        session: JustBashTerminalSession;
    }>) => Promise<void> | void;
}>;
export type AttachedJustBashTerminal = Readonly<{
    workspace: OpfsWorkspace;
    bash: Bash;
    session: JustBashTerminalSession;
    readonly cwd: string;
    execute: JustBashTerminalSession["execute"];
    dispose: () => Promise<void>;
}>;
/** Exposes an OPFS workspace through just-bash's filesystem contract. */
export declare const createJustBashFileSystem: (workspace: WorkspaceFileSystem) => IFileSystem;
/**
 * Adds interactive terminal behavior to a Bash instance without coupling it to
 * a renderer. Pass xterm.js, wterm, or another terminal's input to handleInput.
 */
export declare const createJustBashTerminalSession: (bash: Bash, options?: Readonly<{
    cwd?: string;
    prompt?: string | ((cwd: string) => string);
}>) => JustBashTerminalSession;
/**
 * Attaches a durable OPFS-backed just-bash session to any terminal exposing
 * write() and onData(). xterm.js and wterm both satisfy this small contract.
 */
export declare const attachJustBashTerminal: (options: AttachJustBashTerminalOptions) => Promise<AttachedJustBashTerminal>;
//# sourceMappingURL=just-bash.d.ts.map