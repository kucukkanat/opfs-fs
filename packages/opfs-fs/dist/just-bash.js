/** Exposes an OPFS workspace through just-bash's filesystem contract. */
export const createJustBashFileSystem = (workspace) => workspace;
const terminalText = (value) => value.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
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
    const prompt = () => `opfs:${cwd}$ `;
    const writePrompt = (write) => write(prompt());
    const replaceInput = (value, write) => {
        input = value;
        write(`\r\x1b[2K${prompt()}${value}`);
    };
    const execute = async (command) => {
        // Bash.exec scopes cwd to one invocation; promote only standalone cd to session state.
        const standaloneCd = /^cd(?:\s+(?:-L|-P))?(?:\s+[^;&|]+)?\s*$/.test(command);
        const result = await bash.exec(standaloneCd ? `${command} && pwd` : command, { cwd });
        if (!standaloneCd || result.exitCode !== 0)
            return result;
        const lines = result.stdout.replaceAll("\r\n", "\n").split("\n");
        if (lines.at(-1) === "")
            lines.pop();
        const nextCwd = lines.pop();
        if (!nextCwd?.startsWith("/"))
            return result;
        cwd = nextCwd;
        return { ...result, stdout: lines.length === 0 ? "" : `${lines.join("\n")}\n` };
    };
    const run = async (command, write) => {
        const result = await execute(command);
        if (result.stdout)
            write(terminalText(result.stdout));
        if (result.stderr)
            write(terminalText(result.stderr));
    };
    const handleInput = (data, write) => {
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
                    replaceInput(historyIndex < 0 ? "" : history[historyIndex] ?? "", write);
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
                execution = execution
                    .then(() => run(command, write))
                    .catch((error) => write(`${error instanceof Error ? error.message : "An unknown error occurred."}\r\n`))
                    .finally(() => writePrompt(write));
            }
            else if (character === "\u007f") {
                if (input) {
                    input = input.slice(0, -1);
                    historyIndex = -1;
                    write("\b \b");
                }
            }
            else if (character === "\u0003") {
                input = "";
                historyIndex = -1;
                write("^C\r\n");
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
        get cwd() { return cwd; },
        get history() { return history.slice(); },
        execute,
        handleInput,
        writePrompt,
    };
};
//# sourceMappingURL=just-bash.js.map