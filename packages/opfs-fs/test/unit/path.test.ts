import { expect, test } from "bun:test"
import { normalizePath } from "../../src/path.js"

test("normalizes relative paths without allowing a workspace escape", () => {
  expect(normalizePath("src/../note.txt", "/workspace")).toBe("/workspace/note.txt")
  expect(() => normalizePath("../../outside", "/workspace")).toThrow("Path escapes")
})
