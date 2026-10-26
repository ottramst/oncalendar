# Golden test generator

Expected values for the tests come from `systemd-analyze calendar` itself, not from systemd's
LGPL-licensed `test-calendarspec.c`. That file is useful as a checklist of _what_ to test.

Plan:

1. `expressions.txt` lists the inputs: shorthands, weekday lists and ranges, `~` end-of-month, `/` repetition,
   fractional seconds, `@epoch`, `UTC` and IANA zones, and inputs that must be rejected.
2. For each systemd version in the matrix (for example the systemd shipped by Debian 12, Debian 13, Fedora and
   Arch, covering v252 through v262), run in a container:

   ```shell
   TZ=<zone> systemd-analyze calendar --iterations=10 --base-time=@<unix> '<expression>'
   ```

   for a set of base times around DST transitions in Europe/Berlin, Pacific/Auckland, Europe/Dublin
   (negative DST) and America/New_York.
3. Parse the output (original form, normalized form, next elapses in UTC, or the error) into
   `test/golden/systemd-<version>.json`, recording the exact systemd version and distro image digest.

Generate on glibc-based images only: systemd's next-elapse logic depends on libc `mktime()`.
