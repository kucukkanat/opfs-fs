export class OpfsFsError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "OpfsFsError"
    this.code = code
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

export const posixError = (code: string, message: string): OpfsFsError => new OpfsFsError(code, message)
