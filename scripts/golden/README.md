# Golden test generator

Expected values for the tests come from `systemd-analyze calendar` itself, not from systemd's
LGPL-licensed `test-calendarspec.c`. That file is useful as a checklist of _what_ to test.

```shell
pnpm golden                  # every image in images.json (about 40 s with warm image caches)
pnpm golden fedora:45        # selected images only; differences.json is left alone
pnpm golden:mktime           # compare src/mktime.ts with glibc mktime() (reference image, ~1 min)
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
Pacific/Auckland from 2026-06-15T10:30:00Z. DST expressions also run in the zones listed in `zones.ts`
(night-time one-hour changes, negative DST in Europe/Dublin, midnight changes in Asia/Beirut and
America/Havana, and Australia/Lord_Howe's 30-minute change). They run from one hour before, one minute
before and 30 minutes after each transition in 2026 and 2027. Transitions are found with `Intl`; they
agree with the images' tzdata for these zones.

## Output format

Each case has the input and either `normalized` (plus an optional `warning`, from stderr) or `error` (the
errno text, or `(message truncated)` when systemd cuts off the log line). Each run has `tz`, `base` (unix
seconds) and `elapses`, the next ten elapses in UTC. A run repeats `normalized`/`error`/`warning`, with `null`
for absent, only when its parse result differs from the case's. That happens for zone abbreviations, which
depend on `TZ`. `elapseError` records that systemd failed while computing an elapse (its 1000-step loop
guard gives "Resource deadlock avoided"). systemd-analyze then prints nothing, so the runner reruns with
fewer iterations to recover the elapses before the failure.

## Caveats

- `systemd-analyze calendar` prints elapses to the second and has no JSON output, so fractional-second elapses
  are **truncated** to whole seconds.
- Package installs are not pinned. The exact systemd, glibc and tzdata versions are recorded in each file.
- No image ships systemd v260 or v261 (October 2026): Fedora 44 has v259 and Fedora 45 has v262.
- Debian 13 moved zones like `CET` and `EST5EDT` to `tzdata-legacy`, which `images.json` installs.
