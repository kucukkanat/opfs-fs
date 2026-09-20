export type PosixErrorCode =
  | "EEXIST"
  | "EINVAL"
  | "EISDIR"
  | "ELOOP"
  | "ENAMETOOLONG"
  | "ENOENT"
  | "ENOTDIR"
  | "ENOTEMPTY"
  | "EPERM"
  | "EIO"
export type OpfsFsErrorCode =
  | PosixErrorCode
  | "CAPABILITY_UNAVAILABLE"
  | "CLOSED"
  | "CONFLICT"
  | "CORRUPT_WORKSPACE"
  | "QUOTA_EXCEEDED"
export type OpfsFsErrorOptions = ErrorOptions & Readonly<{ operation?: string; path?: string; workspace?: string }>

/** Stable error codes and optional context; inspect cause for the original storage failure. */
export class OpfsFsError extends Error {
  readonly code: OpfsFsErrorCode
  readonly operation: string | undefined
  readonly path: string | undefined
  readonly workspace: string | undefined

  constructor(code: OpfsFsErrorCode, message: string, options?: OpfsFsErrorOptions) {
    super(message, options)
    this.name = "OpfsFsError"
    this.code = code
    this.operation = options?.operation
    this.path = options?.path
    this.workspace = options?.workspace
  }
}

export class CapabilityError extends OpfsFsError {
  constructor(message: string, options?: ErrorOptions) {
    super("CAPABILITY_UNAVAILABLE", message, options)
    this.name = "CapabilityError"
  }
}

export class ConflictError extends OpfsFsError {
  constructor(message: string) {
    super("CONFLICT", message)
    this.name = "ConflictError"
  }
}

export class CorruptWorkspaceError extends OpfsFsError {
  constructor(message: string, options?: ErrorOptions) {
    super("CORRUPT_WORKSPACE", message, options)
    this.name = "CorruptWorkspaceError"
  }
}

export class QuotaExceededError extends OpfsFsError {
  constructor(message: string, options?: ErrorOptions) {
    super("QUOTA_EXCEEDED", message, options)
    this.name = "QuotaExceededError"
  }
}

export const posixError = (code: PosixErrorCode, message: string, options?: OpfsFsErrorOptions): OpfsFsError =>
  new OpfsFsError(code, message, options)
