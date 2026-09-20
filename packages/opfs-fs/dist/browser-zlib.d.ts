/** Explicit opt-in for just-bash commands that reference the browser Buffer global. */
export declare const installBrowserBuffer: () => void;
/** The synchronous node:zlib subset imported by just-bash's browser entry point. */
export declare const constants: Readonly<{
    Z_BEST_COMPRESSION: 9;
    Z_BEST_SPEED: 1;
    Z_DEFAULT_COMPRESSION: -1;
}>;
export type ZlibOptions = Readonly<{
    level?: number;
    maxOutputLength?: number;
}>;
export declare const gzipSync: (input: Uint8Array, options?: ZlibOptions) => Uint8Array;
export declare const gunzipSync: (input: Uint8Array, options?: ZlibOptions) => Uint8Array;
//# sourceMappingURL=browser-zlib.d.ts.map