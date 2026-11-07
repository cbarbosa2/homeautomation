# Development

Run commands from the repository root so `.env`, static assets, and other relative paths resolve correctly.

## Setup

Install Node.js 26.13 or newer in the 26.x LTS line (the exact default is pinned in `.nvmrc`), then install locked dependencies:

```bash
node --version
npm --version
npm ci
cp .env.example .env
chmod 600 .env
# Edit .env for your installation before starting the service.
```

If you use nvm, run `nvm install` and `nvm use` from the repository root to select `.nvmrc`. With another installation method, ensure `node --version` satisfies the `engines.node` requirement in `package.json`. The project's `.npmrc` enables `engine-strict`, so npm refuses installation with an unsupported Node version. Install development dependencies too: the compiler, test builds, linting, and formatting need them.

See [operations.md](operations.md) for configuration. [bootstrap.ts](../src/bootstrap.ts) loads `.env` before application imports. Existing environment variables take precedence, and a missing `.env` is allowed when configuration comes from the process environment.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Watch production source and setup scripts with `tsc-watch`; restart compiled code after successful builds. |
| `npm start` | Type-check everything, build, and run compiled JavaScript. |
| `npm run bmw:setup` | Build and authorize BMW CarData on this host. See [setup](operations.md#bmw-cardata-setup). |
| `npm run typecheck` | Strictly check all source, setup scripts, and tests without emitting. |
| `npm run build` | Type-check everything, clean `dist/`, and compile production source and setup scripts. |
| `npm test` | Clean `.test-dist/`, compile source/scripts/tests, and run Node tests. |
| `npm run check` | Type-check, then run tests. |
| `npm run lint` | Run ESLint on source and scripts. |
| `npm run fmt` | Format TypeScript, JavaScript tooling, and root JSON configuration. |
| `npm run fmt:check` | Check formatting without rewriting. |
| `npm run analyze` | Run checks, lint, and formatting verification. |

The toolchain uses the TypeScript compiler (`tsc`), ESLint with typescript-eslint's recommended rules, and Prettier. Tests use `node:test` and `node:assert/strict`. ESLint and formatting checks complement the compiler's type checks.

[package.json](../package.json) defines commands and dependencies. The npm lockfile fixes dependency versions. [tsconfig.json](../tsconfig.json) defines shared strict checks, including exact optional properties, unchecked indexed access, type-only imports, and unused code checks. Production and test configs inherit those checks and refuse emission on errors. Keep `.ts` extensions in relative imports; TypeScript rewrites them to `.js` during compilation. Use `import type` for type-only imports.

Development mode uses the production compiler configuration, which excludes test files. Run `npm run typecheck` to check tests as well, or `npm run analyze` for the complete checks. `npm run build` and `npm start` also require a successful type check of source, scripts, and tests before compiling production output.

Production output is `dist/src/bootstrap.js`; the BMW setup command is `dist/scripts/bmw-cardata-setup.js`. Run both from the repository root. Static assets, `.env`, build timestamps, and token files remain relative to that directory. Production and test builds emit ESM JavaScript targeting ES2024 with source maps. The Temporal polyfill remains the shared implementation on Node.

The test command supplies synthetic Victron identifiers and does not load your private `.env`. It runs compiled `*.test.js` files with Node's process isolation; tests in each file run sequentially. For a single compiled test, set `VICTRON_PORTAL_ID=test-portal VICTRON_INSTALLATION_ID=123456` and run `node --test .test-dist/src/path/to/file.test.js` after `npm test` has compiled it. Network-facing migration tests use local sockets or stubbed APIs, and token/setup tests use temporary working directories.

Compiler strictness checks code before execution; it does not validate incoming payloads at runtime.

For formatting selected files, run `npx prettier --write path/to/file.ts`. `npm run fmt` covers TypeScript and JavaScript tooling plus root JSON configuration; it does not format Markdown or the dashboard HTML. Keep blank lines between top-level declarations and distinct logic blocks when reviewing formatting.

No automated test should publish hardware commands; `POWER_CONTROL_ENABLED=false` alone does not disable scheduled SOC writes.

## Date and time

Use Temporal for all date/time-related types in application code and tests. Import it through [src/temporal.ts](../src/temporal.ts).

- Use `Temporal.Instant` for timestamps and recorded events.
- Use `Temporal.ZonedDateTime` for dates and times tied to a time zone, and the appropriate `Temporal.Plain*` type for calendar dates or local times without a time zone.
- Use `Temporal.Duration` for durations.
- Reuse `Clock` and `systemClock` from [src/lisbon-clock.ts](../src/lisbon-clock.ts) for injectable clocks. Use Temporal arithmetic and comparison methods.

Convert to or from numeric timestamps, strings, or `Date` only at external API, serialization, or runtime boundaries that require those representations. Keep internal date/time values as Temporal types.
