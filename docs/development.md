# Development

Run commands from the repository root so `.env`, static assets, and other relative paths resolve correctly.

## Setup

```bash
cp .env.example .env
# Edit .env for your installation before starting the service.
```

See [operations.md](operations.md) for configuration. [bootstrap.ts](../src/bootstrap.ts) loads `.env`; the development and production tasks grant the filesystem and environment permissions it needs.

## Commands

| Command | Purpose |
| --- | --- |
| `deno task dev` | Run with automatic reload. |
| `deno task start` | Run in production mode. |
| `deno check src/*.ts` | Type-check top-level source files and their imports. |
| `deno task test` | Run tests. |
| `deno task check` | Type-check, then run tests. |
| `deno task lint` | Lint source files. |
| `deno task fmt` | Format source files. |

[deno.json](../deno.json) is the source of truth for tasks, permissions, dependencies, and compiler settings.
