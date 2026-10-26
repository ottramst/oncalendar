## Unreleased

## v0.1.0

FEATURES:

- `parse()` and `normalize()` accept and reject the same expressions as `systemd-analyze calendar` (systemd
  262) and produce its normalized form byte for byte. Rejections throw `CalendarSpecError` with systemd's
  errno as `code` (`EINVAL`, `ERANGE` or `ENOBUFS`).
- `parse()` and `normalize()` take an optional `timeZone`, used to recognise that zone's abbreviations
  (`CET`, `NZDT`) the way systemd uses the host's `TZ`.
- `next()` returns the same elapses as `systemd-analyze calendar` (systemd 257 to 262), including DST
  gaps, repeated fall-back hours, negative DST (Europe/Dublin) and transitions at midnight. Time zones go
  through `Intl`, with glibc's `mktime()` behaviour emulated on top, so it runs in browsers too.
- `describe()` returns an English description, such as "At 09:00 on Monday through Friday
  (Europe/Tallinn)".
- `Component.stop` is `null` for components that are not ranges, and `CalendarSpec` gains `dst` for
  abbreviation suffixes.

NOTES:

- Initial project setup
