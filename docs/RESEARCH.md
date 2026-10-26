# Research notes

Background research done before starting the project (October 2026). Links are the sources; re-check
anything marked _unverified_ before relying on it.

## Why this library

- **npm has no complete OnCalendar parser and evaluator.** The nearest packages convert simple cron to
  `.timer` text (`crontab-timer-migration-kit`), ask the host's systemd for next elapses
  (`@crewhaus/tool-cron`), or parse only timespans (`timespan-parser`, 2021). On GitHub there are unpublished
  fragments only, e.g. [systemd-calendar-parser-node](https://github.com/guppy0130/systemd-calendar-parser-node)
  (AST only, `getNext()` TODO).
- **Ports in other languages** (references): Python [cuu508/oncalendar](https://github.com/cuu508/oncalendar)
  (BSD-3, used by Healthchecks; no fractional seconds), Scala/ScalaJS [eikek/calev](https://github.com/eikek/calev)
  (MIT), Ruby [passbe/on_calendar](https://github.com/passbe/on_calendar) (MIT), Go
  [mirendev/runtime pkg/oncalendar](https://github.com/mirendev/runtime/blob/main/pkg/oncalendar/oncalendar.go)
  (Apache-2.0, UTC-only subset) and [synthesio/zcalendar](https://github.com/synthesio/zcalendar) (MIT).
  Avoid DragonReach (GPL-3.0).

## Competing website

[systemd.guru](https://systemd.guru) by Cronitor (the crontab.guru team) is an OnCalendar editor with English
descriptions and next dates. From a static read of its bundle (not run): no IANA zones (local or UTC only), no
fractional seconds, and its [examples page](https://systemd.guru/examples.html) lists expressions systemd's
parser rejects (`*-*-* */6:00:00`, `*-*-~ 23:59:00`, `Mon..Fri *-*-* 08:00:00,17:00:00`). _Unverified_ whether
the live site accepts them.

Other web tools are generators or cron converters that send you to `systemd-analyze` for previews.
[Healthchecks.io](https://blog.healthchecks.io/2023/12/oncalendar-schedules-monitor-systemd-timers-with-healthchecks-io/)
shows a server-side "Expected Ping Dates" table but no English description.

**How to stand out:** byte-for-byte `systemd-analyze` normalization, IANA zones and correct DST, "valid since
systemd vNNN" notes per feature, warnings (never elapses, weekday conflicts with a fixed date), and the
`AccuracySec=` / randomized-delay window explained.

## The spec

Sources: [calendarspec.c](https://github.com/systemd/systemd/blob/main/src/shared/calendarspec.c),
[calendarspec.h](https://github.com/systemd/systemd/blob/main/src/shared/calendarspec.h),
[systemd.time.xml](https://github.com/systemd/systemd/blob/main/man/systemd.time.xml),
[NEWS](https://github.com/systemd/systemd/blob/main/NEWS). Latest release when researched: v262.1.

- Shape: `[weekdays] [date] [time] [tz]`.
- **Shorthands** (case-insensitive): `minutely`, `hourly`, `daily`, `weekly` (Monday), `monthly`, `yearly` /
  `annually` / `anually` (sic), `quarterly`, `semiannually` / `semi-annually` / `biannually` / `bi-annually`.
  A timezone suffix still applies.
- **Weekdays:** `Mon`…`Sun` or full names; `,` lists; `..` or legacy `-` ranges; trailing comma allowed; no `*`.
- **Date:** `Y-M-D` or `M-D`; `~` replaces the last `-` to count from the end of the month (`*-02~03` is the
  3rd-last day; `Mon *-05~07/1` is the last Monday of May). Day must be ≤ 28 with `~`. Two-digit years map
  0–69 → 2000s, 70–99 → 1900s. Years 1970–2199.
- **Time:** `H:M[:S]`, seconds default to `00`; no time means `00:00:00`; no date means `*-*-*`.
- **Fields:** `*` or a comma list of `start[..stop][/repeat]`. `*` cannot take `/` or be in a list. Seconds
  accept decimal fractions (µs precision). Repeat ≠ 0 and must fire at least once. At most 240 components.
- **`@epoch`:** fixed UTC instant. A zone may follow but is ignored (measured: `@1790000000 Europe/Berlin`
  normalizes to `… UTC`).
- **Timezone:** `UTC`, any IANA zone after the last space, or the host's `tzname` abbreviations (model as the
  abbreviations of the selected zone). ISO `T`/`Z` timestamps are _not_ accepted
  ([#44091](https://github.com/systemd/systemd/issues/44091)).

### Normalization

Weekdays as runs (`Mon..Thu,Sat,Sun`; all or none dropped); chains sorted and deduplicated; range end trimmed to
a multiple of the repeat (`*:20..39/5` → `20..35/5`); a repeat that never fires is dropped; seconds `0/1` → `*`;
two-digit padding, four-digit years; fractions as `.420001`, `.000000` dropped; `UTC` uppercase.

### Feature history (from NEWS)

| systemd | Change                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------- |
| v197    | OnCalendar introduced                                                                                          |
| v209    | `yearly`/`annually`, `AccuracySec=`                                                                            |
| v217    | `minutely`, `quarterly`, `semi-annually`                                                                       |
| v228    | `UTC` suffix, sub-second timestamps                                                                            |
| v229    | sub-second calendar accuracy, `RandomizedDelaySec=`                                                            |
| v231    | `..` ranges                                                                                                    |
| v233    | `~` end-of-month, range repetition `9..17/2`                                                                   |
| v235    | IANA timezones                                                                                                 |
| v236    | `systemd-analyze calendar`                                                                                     |
| v242    | `--iterations=`                                                                                                |
| v244    | `--base-time=`                                                                                                 |
| v247    | `FixedRandomDelay=`                                                                                            |
| v258    | `RandomizedOffsetSec=`; fix for negative-DST zones (Europe/Dublin)                                             |
| v258    | warning when a weekday conflicts with a fixed date ([#40350](https://github.com/systemd/systemd/issues/40350)) |
| v260    | fix for `*-*-1/11` skipping Jan 1 at a year change ([#40260](https://github.com/systemd/systemd/issues/40260)) |

Measured with the golden generator (October 2026; v252, v257, v258, v259 and v262): the weekday-conflict
warning first appears in **v258**, not v262 as NEWS suggested. The `*-*-1/11` fix is already in **v257.13**
(Debian 13 and Fedora 42 builds), so it was backported. Our cases show no Dublin difference between v252 and
v262. `@-1` fails with `Invalid argument` in v252 and `Numerical result out of range` from v257.

## Semantics gotchas

- **Next elapse:** start at `after + 1µs`, cascade year → month → day → weekday → hour → minute → µs, bumping
  the parent on overflow; gives up after 2199 or 1000 iterations.
- **Spring forward:** nonexistent local times are skipped, not shifted.
- **Fall back:** a fixed time fires once (first occurrence). Recurring specs skip the second pass through
  the repeated hour, as in [#8647](https://github.com/systemd/systemd/issues/8647) (open since 2018). Measured
  on v252–v262: `minutely` in America/New_York from 01:59 EDT next fires at 02:00 EST, and `hourly` in
  Europe/Berlin from 02:00 CEST next fires at 03:00 CET. When the base time is already inside the second
  pass, elapses continue normally. The Python port repeats the hour instead.
- **Zone abbreviations:** a suffix like `CET` matches the local zone's abbreviation when `TZ` uses it. With
  `TZ=Europe/Berlin`, `*-*-* 12:00 CET` **never elapses** (v262), while under `TZ=UTC` it resolves to the
  tzdata zone `CET`. Abbreviations that are not tzdata zones (`NZST`, `CEST`) fail unless the local zone
  uses them.
- **Whitespace:** leading or trailing whitespace and tabs are rejected; repeated inner spaces are accepted.
- Behaviour depends on libc `mktime()` (glibc vs musl); generate goldens on glibc distros.
- Weekday plus date is AND, unlike cron's OR. Biweekly is not expressible
  ([#6024](https://github.com/systemd/systemd/issues/6024)).
- Multiple `OnCalendar=` lines accumulate, including from drop-ins
  ([#38916](https://github.com/systemd/systemd/issues/38916)); worth explaining on the website.

## Test vectors and licensing

- systemd's [test-calendarspec.c](https://github.com/systemd/systemd/blob/main/src/test/test-calendarspec.c) is
  **LGPL-2.1-or-later** (68 normalization cases, 33 next-elapse cases across several zones, 29 invalid inputs).
  Do not copy it. Use it as a list of _what to test_, then generate expected values ourselves.
- **Golden generator:** run `systemd-analyze calendar --iterations=N --base-time=@X <expr>` with `TZ=...` in
  containers covering several systemd versions (e.g. v252, v257, v258, v260, v262), and commit the JSON with the
  systemd version recorded.
- The Python port's tests are BSD-3-Clause and may be adapted with attribution.

## Related scope (later)

- Timespans (`OnBootSec=1h 30min`; units usec…y with `M` = 30.44 d, `y` = 365.25 d).
- `AccuracySec=`, `RandomizedDelaySec=`, `RandomizedOffsetSec=`, `FixedRandomDelay=`: show as a window; the
  exact offset depends on machine-id so it cannot be reproduced in a browser.
- cron ↔ OnCalendar conversion with lossiness warnings (cron's day-of-month OR day-of-week; `@weekly` is Sunday
  in cron but Monday in systemd; seconds).

## Platform

- Temporal ships in Firefox 139+, Chrome/Edge 144+ and Node 26, but **not Safari** (October 2026), and not in
  Node 22/24 without a flag. Polyfills cost ~20–45 KB gzipped.
- Plan: zero-dependency zone handling through `Intl.DateTimeFormat#formatToParts` (offset from wall-clock
  fields; two-pass local→UTC resolution; detect gaps/overlaps by comparing offsets around the instant), behind
  an internal interface so Temporal can replace it later.

## Demand

- HN "Love systemd timers" (2026-06-02, 396 points, 300 comments):
  [thread](https://news.ycombinator.com/item?id=48367904).
- Unix & Linux SE "systemd timer every 15 minutes" has ~129k views
  ([question](https://unix.stackexchange.com/questions/126786/systemd-timer-every-15-minutes)); similar
  questions have 12k–26k.

## npm name

`oncalendar` was free in October 2026 (as were `systemd-calendar`, `calendarspec`, `timerspec`).
