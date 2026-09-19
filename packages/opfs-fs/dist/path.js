import { posixError } from "./errors.js";
const split = (path) => path.split("/").filter(Boolean);
export const normalizePath = (path, base = "/") => {
    if (path.includes("\0"))
        throw posixError("EINVAL", "Paths cannot contain a NUL byte.");
    const parts = path.startsWith("/") ? [] : split(base);
    for (const part of split(path)) {
        if (part === ".")
            continue;
        if (part === "..") {
            if (parts.length === 0)
                throw posixError("EPERM", `Path escapes the workspace: ${path}`);
            parts.pop();
            continue;
        }
        parts.push(part);
    }
    return `/${parts.join("/")}`;
};
export const parentPath = (path) => {
    const normalized = normalizePath(path);
    if (normalized === "/")
        return "/";
    const index = normalized.lastIndexOf("/");
    return index === 0 ? "/" : normalized.slice(0, index);
};
export const baseName = (path) => {
    const normalized = normalizePath(path);
    if (normalized === "/")
        return "/";
    return normalized.slice(normalized.lastIndexOf("/") + 1);
};
export const isChildPath = (parent, candidate) => {
    const normalizedParent = normalizePath(parent);
    const normalizedCandidate = normalizePath(candidate);
    return normalizedParent === "/" ? normalizedCandidate !== "/" : normalizedCandidate.startsWith(`${normalizedParent}/`);
};
//# sourceMappingURL=path.js.map