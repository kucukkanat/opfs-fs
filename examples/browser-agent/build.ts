export const buildExample = async (): Promise<ReadonlyMap<string, Blob>> => {
  const result = await Bun.build({ entrypoints: [`${import.meta.dir}/src/main.ts`], target: "browser" })
  const javascript = result.outputs[0]
  if (!result.success || !javascript) throw new Error(`Example build failed: ${result.logs.join("\n")}`)
  return new Map<string, Blob>([
    ["/", Bun.file(`${import.meta.dir}/index.html`)],
    ["/main.js", javascript],
    ["/fx-core.wasm", Bun.file(new URL("fx-core.wasm", import.meta.resolve("libfx/browser")))],
  ])
}

if (import.meta.main) {
  const files = await buildExample()
  for (const [path, file] of files)
    await Bun.write(`${import.meta.dir}/dist/${path === "/" ? "index.html" : path.slice(1)}`, file)
}
