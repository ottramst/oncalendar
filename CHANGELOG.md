## Unreleased

FEATURES:

- `parse()` and `normalize()` accept and reject the same expressions as `systemd-analyze calendar` (systemd
  262) and produce its normalized form byte for byte. Rejections throw `CalendarSpecError` with systemd's
  errno as `code` (`EINVAL`, `ERANGE` or `ENOBUFS`).
- `parse()` and `normalize()` take an optional `timeZone`, used to recognise that zone's abbreviations
  (`CET`, `NZDT`) the way systemd uses the host's `TZ`.
- `Component.stop` is `null` for components that are not ranges, and `CalendarSpec` gains `dst` for
  abbreviation suffixes.

NOTES:

- Initial project setup
