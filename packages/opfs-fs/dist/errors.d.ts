export declare class OpfsFsError extends Error {
    readonly code: string;
    constructor(code: string, message: string, options?: ErrorOptions);
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
export declare const posixError: (code: string, message: string) => OpfsFsError;
//# sourceMappingURL=errors.d.ts.map