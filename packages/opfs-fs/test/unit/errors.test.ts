import { expect, test } from "bun:test"
import {
  CapabilityError,
  ConflictError,
  CorruptWorkspaceError,
  OpfsFsError,
  QuotaExceededError,
  posixError,
} from "../../src/errors.js"

test("filesystem errors preserve codes, context, and native causes", () => {
  const cause = new Error("device failure")
  const error = posixError("EIO", "Could not read file", { cause, operation: "read", path: "/note", workspace: "test" })
  expect(error).toBeInstanceOf(OpfsFsError)
  expect(error).toMatchObject({ code: "EIO", cause, operation: "read", path: "/note", workspace: "test" })
  expect(new CapabilityError("unsupported").code).toBe("CAPABILITY_UNAVAILABLE")
  expect(new ConflictError("conflict").code).toBe("CONFLICT")
  expect(new CorruptWorkspaceError("corrupt", { cause }).cause).toBe(cause)
  expect(new QuotaExceededError("full", { cause }).code).toBe("QUOTA_EXCEEDED")
})
