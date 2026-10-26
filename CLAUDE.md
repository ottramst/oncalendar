# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

oncalendar is a zero-dependency TypeScript library (published to npm as ESM) that parses, normalizes, describes
and evaluates systemd `OnCalendar=` expressions, matching `systemd-analyze calendar` exactly. It must run in
Node.js 22+ and browsers, so `src/` uses no Node.js APIs and no Temporal (Safari lacks it); timezones go through
`Intl.DateTimeFormat`. A crontab.guru-style static website will be built on top later, in a `site/` workspace
package. Spec details, prior art, DST gotchas and licensing notes are in `docs/RESEARCH.md`; read it first.

## Common Commands

```bash
pnpm test            # vitest (single file: pnpm test test/spec.test.ts)
pnpm check           # biome check + tsc (no emit)
pnpm format          # biome check --write
pnpm build           # tsdown -> dist/ (ESM + .d.mts)
pnpm check:package   # publint + attw on the packed package
```

## Architecture

- `src/spec.ts`: public types (`CalendarSpec`, `Component`, options) and `CalendarSpecError`.
- `src/parse.ts` (`parse`) and `src/format.ts` (`normalize`) mirror `calendar_spec_from_string()` and
  `calendar_spec_to_string()` in systemd's `src/shared/calendarspec.c`; `src/zone.ts` wraps `Intl`.
  `src/next.ts` (`next`) ports `find_next()`; `src/mktime.ts` emulates glibc's `mktime()` (whose cached
  offset systemd's results depend on) over `src/zone.ts`. `src/index.ts` is the public entry point.
- `test/golden.ts` loads the goldens; tests assert against the newest systemd version in `test/golden/`.
- `scripts/golden/`: generates expected values by running `systemd-analyze` in containers for several systemd
  versions (`pnpm golden`, output in `test/golden/`), and checks `src/mktime.ts` against glibc
  (`pnpm golden:mktime`). Both need Docker.

## Rules

- `systemd-analyze calendar` is the oracle. Never copy systemd's LGPL tests or man page examples; generate
  goldens instead and record the systemd version.
- Zero runtime dependencies. Do not add any without asking.
- `isolatedDeclarations` is on: exported functions need explicit return types.
- Style is enforced by Biome: single quotes, no semicolons, 2-space indent, 100 columns.
- Add a `CHANGELOG.md` entry under `## Unreleased` for user-visible changes.
- Supported Node.js majors are the non-EOL ones; keep `engines`, `.node-version`, the CI matrix and the
  `@types/node` major (oldest supported) in sync.
