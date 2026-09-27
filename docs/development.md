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

## Date and time

Use Temporal for all date/time-related types in application code and tests. Import it through [src/temporal.ts](../src/temporal.ts).

- Use `Temporal.Instant` for timestamps and recorded events.
- Use `Temporal.ZonedDateTime` for dates and times tied to a time zone, and the appropriate `Temporal.Plain*` type for calendar dates or local times without a time zone.
- Use `Temporal.Duration` for durations.
- Reuse `Clock` and `systemClock` from [src/lisbon-clock.ts](../src/lisbon-clock.ts) for injectable clocks. Use Temporal arithmetic and comparison methods.

Convert to or from numeric timestamps, strings, or `Date` only at external API, serialization, or runtime boundaries that require those representations. Keep internal date/time values as Temporal types.
