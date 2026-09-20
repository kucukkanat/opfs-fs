import { Bash } from "just-bash/browser";
import { openWorkspace } from "./workspace.js";
import { OpfsFsError } from "./errors.js";
const bashEncoding = (options) => typeof options === "string" ? options : (options?.encoding ?? undefined);
/** Exposes an OPFS workspace through just-bash's filesystem contract. */
export const createJustBashFileSystem = (workspace) => ({
    readFile: (path, options) => workspace.readFile(path, bashEncoding(options)),
    readFileBuffer: (path) => workspace.readFileBuffer(path),
    writeFile: (path, content, options) => workspace.writeFile(path, content, bashEncoding(options)),
    appendFile: (path, content, options) => workspace.appendFile(path, content, bashEncoding(options)),
    exists: (path) => workspace.exists(path),
    stat: (path) => workspace.stat(path),
    lstat: (path) => workspace.lstat(path),
    mkdir: (path, options) => workspace.mkdir(path, options),
    readdir: (path) => workspace.readdir(path),
    readdirWithFileTypes: (path) => workspace.readdirWithFileTypes(path),
    rm: (path, options) => workspace.rm(path, options),
    cp: (source, destination, options) => workspace.cp(source, destination, options),
    mv: (source, destination) => workspace.mv(source, destination),
    resolvePath: (base, path) => workspace.resolvePath(base, path),
    getAllPaths: () => workspace.getAllPaths(),
    chmod: (path, mode) => workspace.chmod(path, mode),
    symlink: (target, path) => workspace.symlink(target, path),
    link: (existingPath, path) => workspace.link(existingPath, path),
    readlink: (path) => workspace.readlink(path),
    realpath: (path) => workspace.realpath(path),
    utimes: (path, atime, mtime) => workspace.utimes(path, atime, mtime),
});
const terminalText = (value) => value.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
const cwdCaptures = new WeakMap();
const cwdCaptureFor = (bash) => {
    const existing = cwdCaptures.get(bash);
    if (existing)
        return existing;
    const capture = { nextScript: false, cwd: undefined };
    const command = `__opfs_cwd_${crypto.randomUUID().replaceAll("-", "")}`;
    const statements = bash.transform(`${command} "$?"`).ast.statements;
    bash.registerCommand({
        name: command,
        execute: async (args, context) => {
            capture.cwd = context.cwd;
            return { stdout: "", stderr: "", exitCode: Number(args[0] ?? 0) };
        },
    });
    bash.registerTransformPlugin({
        name: command,
        transform: ({ ast }) => {
            if (!capture.nextScript)
                return { ast };
            capture.nextScript = false;
            // Capture interpreter state, not the assignable PWD variable. Only instrument the
            // outer script; child shells must not move the terminal's working directory.
            return { ast: { ...ast, statements: [...ast.statements, ...statements] } };
        },
    });
    // Bash cannot unregister plugins. Reuse one capture that holds no session references.
    cwdCaptures.set(bash, capture);
    return capture;
};
/**
 * Adds interactive terminal behavior to a Bash instance without coupling it to
 * a renderer. Pass xterm.js, wterm, or another terminal's input to handleInput.
 */
export const createJustBashTerminalSession = (bash, options = {}) => {
    let cwd = options.cwd ?? "/";
    let input = "";
    const history = [];
    let historyIndex = -1;
    let escapeSequence = "";
    let execution = Promise.resolve();
    let disposed = false;
    const pending = new Set();
    const capture = cwdCaptureFor(bash);
    const prompt = () => typeof options.prompt === "function"
        ? options.prompt(cwd)
        : (options.prompt ?? "opfs:{cwd}$ ").replaceAll("{cwd}", cwd);
    const writePrompt = (write) => {
        if (!disposed)
            write(prompt());
    };
    const replaceInput = (value, write) => {
        input = value;
        write(`\r\x1b[2K${prompt()}${value}`);
    };
    const execute = (command, executionOptions = {}) => {
        if (disposed)
            return Promise.reject(new OpfsFsError("CLOSED", "This terminal session has been disposed."));
        const controller = new AbortController();
        pending.add(controller);
        const signal = executionOptions.signal === undefined
            ? controller.signal
            : AbortSignal.any([controller.signal, executionOptions.signal]);
        const result = execution
            .then(async () => {
            signal.throwIfAborted();
            capture.cwd = undefined;
            capture.nextScript = true;
            try {
                const result = await bash.exec(command, { cwd, signal });
                if (capture.cwd !== undefined)
                    cwd = capture.cwd;
                return result;
            }
            finally {
                capture.nextScript = false;
            }
        })
            .finally(() => {
            pending.delete(controller);
        });
        // A rejected execution must not poison the queue; its caller still receives the rejection.
        execution = result.then(() => undefined, () => undefined);
        return result;
    };
    const dispose = () => {
        disposed = true;
        for (const controller of pending)
            controller.abort();
        return execution;
    };
    const run = async (command, write) => {
        try {
            const result = await execute(command);
            if (!disposed && result.stdout)
                write(terminalText(result.stdout));
            if (!disposed && result.stderr)
                write(terminalText(result.stderr));
        }
        catch (error) {
            if (!disposed && !(error instanceof Error && error.name === "AbortError"))
                write(`${error instanceof Error ? error.message : "An unknown error occurred."}\r\n`);
        }
        finally {
            writePrompt(write);
        }
    };
    const handleInput = (data, write) => {
        if (disposed)
            return;
        for (const character of data) {
            if (escapeSequence) {
                escapeSequence += character;
                if (escapeSequence === "\u001b[A") {
                    const next = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
                    if (next >= 0) {
                        historyIndex = next;
                        replaceInput(history[next] ?? "", write);
                    }
                    escapeSequence = "";
                }
                else if (escapeSequence === "\u001b[B") {
                    const next = historyIndex + 1;
                    historyIndex = next >= history.length ? -1 : next;
                    replaceInput(historyIndex < 0 ? "" : (history[historyIndex] ?? ""), write);
                    escapeSequence = "";
                }
                else if (escapeSequence.length > 2 && /[A-Za-z~]/.test(character)) {
                    escapeSequence = "";
                }
                continue;
            }
            if (character === "\u001b") {
                escapeSequence = character;
                continue;
            }
            if (character === "\r" || character === "\n") {
                const command = input;
                input = "";
                if (command.trim() && history.at(-1) !== command)
                    history.push(command);
                historyIndex = -1;
                write("\r\n");
                void run(command, write);
            }
            else if (character === "\u007f") {
                if (input) {
                    input = input.slice(0, -1);
                    historyIndex = -1;
                    write("\b \b");
                }
            }
            else if (character === "\u0003") {
                const executing = pending.size > 0;
                for (const controller of pending)
                    controller.abort();
                input = "";
                historyIndex = -1;
                write("^C\r\n");
                if (!executing)
                    writePrompt(write);
            }
            else if (character >= " ") {
                input += character;
                historyIndex = -1;
                write(character);
            }
        }
    };
    return {
        get cwd() {
            return cwd;
        },
        get history() {
            return history.slice();
        },
        execute,
        dispose,
        handleInput,
        writePrompt,
    };
};
/**
 * Attaches a durable OPFS-backed just-bash session to any terminal exposing
 * write() and onData(). xterm.js and wterm both satisfy this small contract.
 */
export const attachJustBashTerminal = async (options) => {
    const injected = "instance" in options.workspace ? options.workspace : undefined;
    const workspace = "instance" in options.workspace ? options.workspace.instance : await openWorkspace(options.workspace);
    const owned = injected === undefined || injected.ownership === "owned";
    let session;
    let subscription;
    let disposed = false;
    const write = (value) => {
        if (!disposed)
            options.terminal.write(value);
    };
    try {
        const cwd = workspace.root;
        const bash = new Bash({
            fs: createJustBashFileSystem(workspace),
            cwd,
            ...(options.executionLimitProfile === undefined ? {} : { executionLimitProfile: options.executionLimitProfile }),
        });
        const activeSession = createJustBashTerminalSession(bash, {
            cwd,
            ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
        });
        session = activeSession;
        await options.initialize?.({ workspace, bash, session: activeSession });
        subscription = options.terminal.onData((data) => activeSession.handleInput(data, write));
        if (options.banner)
            write(`${terminalText(options.banner)}${options.banner.endsWith("\n") ? "" : "\r\n"}`);
        activeSession.writePrompt(write);
        let disposal;
        const dispose = () => {
            if (disposal)
                return disposal;
            disposed = true;
            subscription?.dispose();
            disposal = activeSession.dispose().then(() => {
                if (owned)
                    workspace.close();
            });
            return disposal;
        };
        return {
            workspace,
            bash,
            session: activeSession,
            get cwd() {
                return activeSession.cwd;
            },
            execute: activeSession.execute,
            dispose,
        };
    }
    catch (error) {
        disposed = true;
        subscription?.dispose();
        await session?.dispose();
        if (owned)
            workspace.close();
        throw error;
    }
};
//# sourceMappingURL=just-bash.js.map