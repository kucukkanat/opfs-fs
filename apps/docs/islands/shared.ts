export const demoWorkspaceName = (demo: string): string => {
  const key = `opfs-fs-docs:${demo}`
  const existing = window.localStorage.getItem(key)
  if (existing) return existing
  const created = `${demo}-${crypto.randomUUID()}`
  window.localStorage.setItem(key, created)
  return created
}

export const formatError = (error: unknown): string => error instanceof Error ? error.message : "An unknown error occurred."
