export class OpfsFsError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = "OpfsFsError";
        this.code = code;
    }
}
export class CapabilityError extends OpfsFsError {
    constructor(message, options) {
        super("CAPABILITY_UNAVAILABLE", message, options);
        this.name = "CapabilityError";
    }
}
export class ConflictError extends OpfsFsError {
    constructor(message) {
        super("CONFLICT", message);
        this.name = "ConflictError";
    }
}
export class CorruptWorkspaceError extends OpfsFsError {
    constructor(message, options) {
        super("CORRUPT_WORKSPACE", message, options);
        this.name = "CorruptWorkspaceError";
    }
}
export class QuotaExceededError extends OpfsFsError {
    constructor(message, options) {
        super("QUOTA_EXCEEDED", message, options);
        this.name = "QuotaExceededError";
    }
}
export const posixError = (code, message) => new OpfsFsError(code, message);
//# sourceMappingURL=errors.js.map