# Contributing

Thanks for your interest in improving oncalendar. Bug reports, feature requests and pull requests are all
welcome. By participating you agree to follow the [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## Reporting issues

Use the [issue templates](https://github.com/ottramst/oncalendar/issues/new/choose). For a wrong result,
include the expression, the timezone, and the output of
`systemd-analyze calendar --iterations=5 '<expression>'` together with `systemd --version`. Report security
vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## Development setup

Requirements: [Node.js](https://nodejs.org/) 22 or newer, [pnpm](https://pnpm.io/) (the version in
`packageManager` in `package.json`), and Docker to regenerate the golden test vectors.

```shell
pnpm install
pnpm test        # vitest
pnpm check       # biome lint + format check, tsc
pnpm format      # apply biome fixes and formatting
pnpm build       # bundle to dist/ with tsdown
pnpm check:package  # publint + are-the-types-wrong on the built package
```

## Correctness rules

- `systemd-analyze calendar` is the source of truth. When this library and systemd disagree, systemd wins,
  unless systemd has a confirmed bug; then document the difference.
- Expected values come from the golden generator in [scripts/golden/](scripts/golden/README.md). Never copy
  systemd's `test-calendarspec.c` or man page examples (LGPL) into the repository.

## Pull requests

- Keep each pull request focused on one change, and add or update tests for it.
- Add an entry to `CHANGELOG.md` under `## Unreleased` (`FEATURES`, `BUG FIXES` or `NOTES`).
- CI must pass: the `CI gate` check covers lint, typecheck, tests on every supported Node.js version, and
  the package build.

## Releases

Maintainers release by bumping `version` in `package.json`, moving the `## Unreleased` entries in
`CHANGELOG.md` under a new `## vX.Y.Z` heading, and pushing a matching `vX.Y.Z` tag. The release workflow
checks that the tag matches `package.json`, runs the full check suite, publishes to npm through trusted
publishing (with provenance), and creates a GitHub release from that `CHANGELOG.md` section.
