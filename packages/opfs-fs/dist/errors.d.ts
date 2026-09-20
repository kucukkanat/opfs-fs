export type PosixErrorCode = "EEXIST" | "EINVAL" | "EISDIR" | "ELOOP" | "ENAMETOOLONG" | "ENOENT" | "ENOTDIR" | "ENOTEMPTY" | "EPERM" | "EIO";
export type OpfsFsErrorCode = PosixErrorCode | "CAPABILITY_UNAVAILABLE" | "CLOSED" | "CONFLICT" | "CORRUPT_WORKSPACE" | "QUOTA_EXCEEDED";
export type OpfsFsErrorOptions = ErrorOptions & Readonly<{
    operation?: string;
    path?: string;
    workspace?: string;
}>;
/** Stable error codes and optional context; inspect cause for the original storage failure. */
export declare class OpfsFsError extends Error {
    readonly code: OpfsFsErrorCode;
    readonly operation: string | undefined;
    readonly path: string | undefined;
    readonly workspace: string | undefined;
    constructor(code: OpfsFsErrorCode, message: string, options?: OpfsFsErrorOptions);
}
export declare class CapabilityError extends OpfsFsError {
    constructor(message: string, options?: ErrorOptions);
}
export declare class ConflictError extends OpfsFsError {
    constructor(message: string);
}
export declare class CorruptWorkspaceError extends OpfsFsError {
    constructor(message: string, options?: ErrorOptions);
}
export declare class QuotaExceededError extends OpfsFsError {
    constructor(message: string, options?: ErrorOptions);
}
export declare const posixError: (code: PosixErrorCode, message: string, options?: OpfsFsErrorOptions) => OpfsFsError;
//# sourceMappingURL=errors.d.ts.map