# Golden test generator

Expected values for the tests come from `systemd-analyze calendar` itself, not from systemd's
LGPL-licensed `test-calendarspec.c`. That file is useful as a checklist of _what_ to test.

```shell
pnpm golden                  # every image in images.json (about 40 s with warm image caches)
pnpm golden fedora:45        # selected images only; differences.json is left alone
```

Docker is required. The output is deterministic apart from the `generated` date.

## Files

- `expressions.txt`: the inputs. Expressions in `## [dst]` sections also run against base times around DST
  transitions. `generate.ts` appends a few very long lists that probe the component limit.
- `images.json`: glibc images pinned by multi-arch index digest. systemd's next-elapse logic depends on libc
  `mktime()`, so musl images are not used. The last entry is the reference version.
- `run-in-container.sh`: runs `TZ=<zone> systemd-analyze calendar --iterations=10 --base-time=@<unix> -- <expr>`
  for each case and prints delimited records.
- `generate.ts`: builds the case matrix, runs every image in parallel, parses the output, and writes
  `test/golden/systemd-<version>.json` plus `test/golden/differences.json` (runs whose outcome differs
  between versions).

## Case matrix

Every expression runs in `UTC` from 2026-06-15T10:30:00Z and 2026-12-31T23:59:30Z, and in Europe/Berlin and
Pacific/Auckland from 2026-06-15T10:30:00Z. DST expressions also run in Europe/Berlin, Pacific/Auckland,
Europe/Dublin (negative DST) and America/New_York from one hour before, one minute before and 30 minutes
after each transition in 2026 and 2027. Transitions are found with `Intl`.

## Output format

Each case has the input and either `normalized` (plus an optional `warning`, from stderr) or `error` (the
errno text, or `(message truncated)` when systemd cuts off the log line). Each run has `tz`, `base` (unix
seconds) and `elapses`, the next ten elapses in UTC. A run repeats `normalized`/`error`/`warning`, with `null`
for absent, only when its parse result differs from the case's. That happens for zone abbreviations, which
depend on `TZ`.

## Caveats

- `systemd-analyze calendar` prints elapses to the second and has no JSON output, so fractional-second elapses
  are **truncated** to whole seconds.
- Package installs are not pinned. The exact systemd, glibc and tzdata versions are recorded in each file.
- No image ships systemd v260 or v261 (October 2026): Fedora 44 has v259 and Fedora 45 has v262.
- Debian 13 moved zones like `CET` and `EST5EDT` to `tzdata-legacy`, which `images.json` installs.
