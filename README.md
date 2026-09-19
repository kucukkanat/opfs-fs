# opfs-fs

`@kucukkanat/opfs-fs` is an ergonomic, durable browser filesystem on OPFS.
It is a Bun workspace containing the core SDK and its `just-bash` adapter.

```sh
bun install
bun run build
bun test
bun run test:integration
```

The integration suite is reserved for real-browser OPFS tests; it is separate
from pure unit tests by design.
