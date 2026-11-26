# `@workspace/test`

Test-only helpers for what `bun:test` lacks, shared by the client, dit, the server and the UI package as a
devDependency. Consumed as source through `"./*": "./src/*.ts"`.

| Module | Helpers |
| --- | --- |
| `globals` | `stubGlobal(name, value)` redefines a global property (so accessor globals like `navigator` can be replaced) and `unstubAllGlobals()` restores the original descriptors |
| `env` | `stubEnv(name, value \| undefined)` and `unstubAllEnvs()` |
| `timers` | `advanceTimersByTimeAsync(ms)` steps fake time a millisecond at a time with a real `setImmediate` between ticks, stopping early once no timer is pending |
| `wait-for` | `waitFor(fn, { timeout, interval })` retries until `fn` stops throwing; the way to wait on a database-backed job without fake timers |

Import as `@workspace/test/globals` and so on. Scripts: `bun run typecheck`, `bun run lint`.
