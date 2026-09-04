# Contributing

Thanks for your interest in **Robusty**! We'd love your help to make it better. Here's how you can get involved:

- **Create an Issue**: spot a bug? Have an idea for a new command or flag? Let us know by creating an issue.
- **Submit a Pull Request**: found something to fix or improve? Jump in and submit a PR!
- **Spread the word**: share your experience with Robusty on social media, blogs, or with your tech community.

## Development

This project uses **pnpm** as its package manager and targets the Node.js version pinned in `.nvmrc`.

1. Create a fork of the repository.
2. Create a new branch for your changes.
3. Run `nvm use` to use the correct Node.js version.
4. Run `pnpm install` to install dependencies.
5. Run `pnpm dev` to build the CLI in watch mode.
6. Make your changes.
7. Test your changes by running the built binary directly: `node dist/cli.mjs <command>`.
8. Before pushing, run the checks below and make sure they pass.
9. Push your changes and create a PR to this repository.
10. Wait for the feedback.

## Checks

Run these locally before opening a PR:

- Build: `pnpm build`
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint` (autofix with `pnpm lint:fix`)
- Format: `pnpm format:check` (autofix with `pnpm format`)
- Test: `pnpm test`

`pnpm test` runs the full vitest suite. Its `pretest` hook rebuilds `dist/` first, because the CLI end-to-end tests spawn the built `dist/cli.mjs` binary — so always use `pnpm test` rather than invoking vitest directly.

## Conventions

- **Commands** live in `src/commands/` (one file per subcommand). Domain logic lives in feature dirs under `src/` (e.g. `src/auth/`, `src/project/`, `src/launch/`).
- **Dependency injection:** each command exports a testable `run<Name>(...)` function plus a `<Name>Dependencies` interface with a `defaultDependencies`. Tests inject fakes for these deps rather than mocking modules. Follow this pattern when adding a command.
- **HTTP:** `src/http.ts` holds the generic `apiRequest` transport (Bearer auth, JSON encode/decode, `--debug` diagnostics, network-failure wrapping). Each domain wraps it with its own `mapError`.
- **Errors:** throw `CliError` (or `ApiError`) from `src/errors.ts` for user-facing failures.
- **Validation:** validate external/parsed data with zod schemas in `src/schemas.ts`.
- **Tests** are colocated `*.test.ts` next to the source they cover.

## Releasing

Releasing new versions is automated by [changesets](https://github.com/changesets/changesets). To create a new version, add and push a changeset file by running `pnpm changesets`. After merging it to the main branch, the new version will be automatically published to npm, along with updating the changelog.

Maintainers will also [create a new release on GitHub](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository#creating-a-release).

---

### Thank you for contributing ❤️
