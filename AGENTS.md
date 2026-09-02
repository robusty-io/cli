# AGENTS.md

Robusty (robusty.io) is an AI-powered end-to-end testing platform that validates a web product like a real customer to catch regressions before release. Test cases are written in plain English and run by an AI agent in a real cloud browser; runs can be triggered manually, on a schedule, or in CI/CD.

This repo is `@robusty/cli` — the `robusty` command-line tool for creating, managing, and running those tests from a terminal or CI. It talks to the Robusty web app (auth) and the launcher API (running tests). Single package, ESM, TypeScript. Package manager is **pnpm**.

## Commands

- Build: `pnpm build` (tsdown; bundles `src/cli.ts` -> `dist/cli.mjs`)
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint` (oxlint) / autofix: `pnpm lint:fix`
- Format: `pnpm format` (oxfmt) / check-only: `pnpm format:check`
- Test: `pnpm test` (vitest run; fast — always run the full suite rather than individual files)

## Gotchas

- **CLI e2e tests need a fresh `dist/`.** `src/cli.test.ts` spawns the built `dist/cli.mjs` binary. `pnpm test`'s `pretest` hook runs `pnpm build` first, so `pnpm test` always works. (Invoking vitest directly skips this build — another reason to just use `pnpm test`.)
- tsconfig is strict with extras: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`. Use `import type` for type-only imports.

## Architecture

- Entry: `src/cli.ts` uses **citty**. Subcommands are lazily imported and wrapped by `withErrorHandling` (`src/with-error-handling.ts`). No-args behavior is a hidden `root` subcommand (not `run`) to avoid citty double-printing — do not move it back to a root `run`.
- Commands live in `src/commands/` (one file per subcommand, e.g. `login.ts`). Domain logic lives in feature dirs under `src/` (e.g. `src/auth/`, `src/project/`, `src/launch/`).
- **Errors:** throw `CliError` (or `ApiError`) from `src/errors.ts` for user-facing failures; these are caught centrally, printed as one line, and set `process.exitCode`. Any other thrown error bubbles up as a stack trace.
- **HTTP:** all launcher API calls go through `launcherRequest` in `src/http.ts`, which maps HTTP status codes to `ApiError` messages. Never log the token or `Authorization` header.
- **Validation:** external/parsed data is validated with **zod** schemas in `src/schemas.ts`.
- **Config:** `loadConfig` (`src/config.ts`) reads env vars `ROBUSTY_TOKEN`, `ROBUSTY_WEB_URL`, `ROBUSTY_LAUNCHER_URL` (URLs are internal overrides; defaults point to robusty.io).
- **Credentials:** `src/auth/credential-store.ts` prefers the OS keyring (`@napi-rs/keyring`) and falls back to a `0600` `auth.json` under a platform config dir.

## Conventions

- Each command exports a testable `run<Name>(...)` function plus a `<Name>Dependencies` interface with a `defaultDependencies`. Tests inject fakes for these deps rather than mocking modules. Follow this DI pattern when adding a command.
- Tests are colocated `*.test.ts` next to source, using vitest.
