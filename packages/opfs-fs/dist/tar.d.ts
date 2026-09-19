export type TarEntry = Readonly<{
    path: string;
    data: Uint8Array;
    mode: number;
    mtime: Date;
    type: "file" | "directory" | "symlink";
    linkTarget?: string;
}>;
export declare const encodeTar: (entries: readonly TarEntry[]) => Uint8Array;
export declare const decodeTar: (archive: Uint8Array) => TarEntry[];
//# sourceMappingURL=tar.d.ts.map