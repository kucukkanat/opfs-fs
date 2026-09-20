# @kucukkanat/opfs-fs

## 0.1.0

### Minor Changes

- 44cf5dc: Add durable, transactional OPFS workspaces and the `just-bash` filesystem adapter.
- 77f9c68: Isolate transaction handles, protect readers during storage collection, and preserve filesystem semantics for links, filenames, appends, and TAR round trips. Add committed revision subscriptions, contextual typed errors, diagnostic events, and readable text/byte aliases.

  Serialize terminal execution and support cancellation, asynchronous disposal, and explicitly borrowed workspaces. Add opaque fx checkpoint persistence and an optional browser gzip shim for just-bash bundlers. Include TypeScript sources for installed-package debugging.

  Terminal disposal now returns a promise: await it when subsequent work requires storage shutdown to finish. Transaction callbacks must use their supplied filesystem handle. The root option remains an initial directory/archive scope rather than an access boundary.
