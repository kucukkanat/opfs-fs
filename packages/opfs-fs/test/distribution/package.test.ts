import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const packageRoot = resolve(import.meta.dir, "../..")
const repository = resolve(packageRoot, "../..")

const run = async (cwd: string, args: readonly string[]): Promise<string> => {
  const process = Bun.spawn([Bun.which("bun") ?? "bun", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  if (code !== 0) throw new Error(`${args.join(" ")} failed (${code})\n${stdout}\n${stderr}`)
  return stdout
}

test("a packed consumer can import core without optional peers and resolve shipped source maps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opfs-package-"))
  try {
    const archive = join(directory, "opfs-fs.tgz")
    await run(packageRoot, ["pm", "pack", "--filename", archive, "--ignore-scripts", "--quiet"])
    await Bun.write(
      join(directory, "package.json"),
      JSON.stringify({
        name: "opfs-consumer",
        private: true,
        type: "module",
        dependencies: { "@kucukkanat/opfs-fs": `file:${archive}` },
      }),
    )
    await run(directory, ["install", "--ignore-scripts"])
    await Bun.write(
      join(directory, "smoke.ts"),
      `
import { CapabilityError, openWorkspace, encodeTar, decodeTar } from "@kucukkanat/opfs-fs"
import { createFxCheckpointStore } from "@kucukkanat/opfs-fs/fx"
if (decodeTar(encodeTar([])).length !== 0 || typeof createFxCheckpointStore !== "function") throw new Error("exports failed")
try { await openWorkspace({ name: "server" }); throw new Error("Expected capability failure") }
catch (error) { if (!(error instanceof CapabilityError)) throw error }
console.log("core consumer passed")
`,
    )
    expect(await run(directory, ["smoke.ts"])).toContain("core consumer passed")
    for (const peer of ["just-bash", "fflate", "buffer"])
      expect(await Bun.file(join(directory, "node_modules", peer, "package.json")).exists()).toBe(false)
    const installed = join(directory, "node_modules/@kucukkanat/opfs-fs")
    for (const entry of ["index", "workspace", "tar", "just-bash", "fx", "browser-zlib"]) {
      for (const suffix of ["js.map", "d.ts.map"]) {
        const mapPath = join(installed, "dist", `${entry}.${suffix}`)
        const map: unknown = await Bun.file(mapPath).json()
        if (typeof map !== "object" || map === null || !("sources" in map) || !Array.isArray(map.sources))
          throw new Error(`Invalid source map ${mapPath}`)
        for (const source of map.sources) {
          if (typeof source !== "string") throw new Error("Source path must be a string")
          expect(await Bun.file(resolve(dirname(mapPath), source)).exists()).toBe(true)
        }
      }
    }
    await Bun.write(
      join(directory, "consumer.ts"),
      `
import { openWorkspace, type OpfsFsErrorCode } from "@kucukkanat/opfs-fs"
import { createFxCheckpointStore } from "@kucukkanat/opfs-fs/fx"
const fs = await openWorkspace({ name: "browser" })
const bytes: Uint8Array = await fs.readBytes("/note")
const text: string = await fs.readText("/note")
const code: OpfsFsErrorCode = "ENOENT"
createFxCheckpointStore(fs, "/checkpoint")
fs.subscribe(() => console.log(fs.getSnapshot(), bytes, text, code))
`,
    )
    await run(directory, [
      join(repository, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "consumer.ts",
    ])
    await Bun.write(
      join(directory, "package.json"),
      JSON.stringify({
        name: "opfs-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@kucukkanat/opfs-fs": `file:${archive}`,
          "just-bash": "3.4.2",
          fflate: "0.8.3",
          buffer: "6.0.3",
        },
      }),
    )
    await run(directory, ["install", "--ignore-scripts"])
    await Bun.write(
      join(directory, "optional.ts"),
      `
import { Bash, InMemoryFs } from "just-bash/browser"
import { createJustBashFileSystem, createJustBashTerminalSession } from "@kucukkanat/opfs-fs/just-bash"
import { encodeTar, decodeTar } from "@kucukkanat/opfs-fs/tar"
import { gzipSync, gunzipSync, installBrowserBuffer } from "@kucukkanat/opfs-fs/browser-zlib"
installBrowserBuffer()
const content = new TextEncoder().encode("packed consumer")
if (new TextDecoder().decode(gunzipSync(gzipSync(content))) !== "packed consumer") throw new Error("gzip failed")
if (typeof createJustBashFileSystem !== "function" || decodeTar(encodeTar([])).length !== 0) throw new Error("subpath export failed")
const session = createJustBashTerminalSession(new Bash({ fs: new InMemoryFs() }))
if ((await session.execute("printf packed")).stdout !== "packed") throw new Error("shell failed")
await session.dispose()
console.log("optional consumer passed")
`,
    )
    expect(await run(directory, ["optional.ts"])).toContain("optional consumer passed")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)
