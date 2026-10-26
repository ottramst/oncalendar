/**
 * systemd calendar event expressions, as accepted by `OnCalendar=` (systemd.time(7)).
 *
 * Reference implementation: systemd src/shared/calendarspec.c. Behaviour is pinned to
 * `systemd-analyze calendar` output, which is the oracle for the golden tests.
 */

/** One `start[..stop][/repeat]` item in a field's comma-separated list. */
export interface Component {
  readonly start: number
  /** Inclusive end of a `..` range, or `null` when the component is not a range. */
  readonly stop: number | null
  /** Repetition step; `0` when the component does not repeat. Ranges without `/` repeat by 1. */
  readonly repeat: number
}

export interface CalendarSpec {
  /** Bitmask of weekdays, Monday = bit 0. `0x7f` (all days) when unrestricted. */
  readonly weekdays: number
  /** `null` means `*`. */
  readonly year: readonly Component[] | null
  readonly month: readonly Component[] | null
  readonly day: readonly Component[] | null
  /** Day counts from the end of the month (`~` syntax). */
  readonly endOfMonth: boolean
  readonly hour: readonly Component[] | null
  readonly minute: readonly Component[] | null
  /** Seconds in microseconds, to support fractions. `null` means `*` (every whole second). */
  readonly microsecond: readonly Component[] | null
  /**
   * `UTC`, an IANA zone name, a time zone abbreviation of the evaluating zone (see {@link dst}), or
   * `null` for the evaluating zone.
   */
  readonly timeZone: string | null
  /**
   * Set when {@link timeZone} is an abbreviation of the zone the expression was parsed for (`CET` or
   * `CEST` in Europe/Berlin): `false` for standard time, `true` for daylight saving time. Such a spec
   * only elapses while that abbreviation is in effect. `null` otherwise.
   */
  readonly dst: boolean | null
}

/** systemd's errno for a rejected expression. */
export type CalendarSpecErrorCode = 'EINVAL' | 'ERANGE' | 'ENOBUFS'

export class CalendarSpecError extends Error {
  override readonly name = 'CalendarSpecError'
  readonly code: CalendarSpecErrorCode

  constructor(message: string, code: CalendarSpecErrorCode = 'EINVAL') {
    super(message)
    this.code = code
  }
}

export interface ParseOptions {
  /**
   * IANA zone the expression is meant for. Only used to recognise that zone's abbreviations (`CET`,
   * `NZDT`) as a suffix, like systemd does with the host's `TZ`. Defaults to the runtime's zone. An
   * unknown zone throws a `RangeError` from `Intl`.
   */
  readonly timeZone?: string
}

export interface NextOptions {
  /**
   * Find elapses strictly after this instant. Defaults to now.
   *
   * Returned dates are truncated to whole milliseconds. For an expression with sub-millisecond
   * seconds (`*:*:1.420001`), passing the last returned date back as `after` finds that same elapse
   * again: ask for a larger `count` instead, or pass a date 1 ms later.
   */
  readonly after?: Date
  /** IANA zone used when the expression has none. Defaults to the runtime's zone. */
  readonly timeZone?: string
  /**
   * Number of elapses to return. Defaults to 1. Like one `systemd-analyze calendar --iterations=N`
   * run, the elapses are computed in sequence, so in the rare cases where glibc's mktime() depends on
   * its previous call (times in a repeated fall-back hour), `count: 10` can differ from ten calls with
   * `count: 1`.
   */
  readonly count?: number
}
