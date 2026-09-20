import { buildExample } from "./build.js"

export const startExample = async (port = 3000) => {
  const files = await buildExample()
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(request) {
      const path = new URL(request.url).pathname
      const file = files.get(path)
      if (!file) return new Response("Not found", { status: 404 })
      const type = path === "/" ? "text/html" : path.endsWith(".wasm") ? "application/wasm" : "text/javascript"
      return new Response(file, { headers: { "content-type": type } })
    },
  })
}

if (import.meta.main) {
  const server = await startExample(Number(process.env.PORT ?? 3000))
  console.log(`Browser workspace: ${server.url}`)
}
