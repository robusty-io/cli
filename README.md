<p align="center">
  <a href="https://www.robusty.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./logo-dark.png">
      <img src="./logo.png" alt="Robusty" width="260">
    </picture>
  </a>
</p>

<p align="center">
  Create, manage and run AI-powered end-to-end tests from your terminal or CI.
</p>

---

Robusty validates your web product like a real customer, catching regressions before release and adapting automatically as your product evolves. Test cases are written in plain English and run by an AI agent in a real cloud browser. This CLI lets you launch those tests from your terminal and wire them into CI/CD.

## Installation

```sh
npm install -g @robusty/cli
```

Or run it without installing:

```sh
npx @robusty/cli login
```

## Usage

### Log in and link a project

Authenticate in your browser and link the current directory to a Robusty project:

```sh
robusty login
```

Already logged in? Link (or re-link) the current directory:

```sh
robusty link
robusty link --project "My Project" # by exact name or project UID
```

### Launch a test suite

```sh
robusty launch --suite <suite-id>
```

Override project variables with repeatable `--var` flags:

```sh
robusty launch --suite <suite-id> --var BASE_URL=https://staging.example.com --var USER=demo
```

The CLI streams live progress and exits with a non-zero status if any test fails.

### Log out

```sh
robusty logout
```

## Running in CI

In CI, skip the browser login and authenticate with a project token instead. Create one in your Robusty account settings and expose it as `ROBUSTY_TOKEN`:

```sh
export ROBUSTY_TOKEN=rbst_...
robusty launch --suite <suite-id>
```

With a project token set, `launch` targets that project directly — no `robusty link` step required.

## Help

Use `--help` on any command to see its flags:

```sh
robusty --help
robusty launch --help
```

## Contributing

Contributions are welcome. Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for more details.
