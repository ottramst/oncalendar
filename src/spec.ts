/**
 * systemd calendar event expressions, as accepted by `OnCalendar=` (systemd.time(7)).
 *
 * Reference implementation: systemd src/shared/calendarspec.c. Behaviour is pinned to
 * `systemd-analyze calendar` output, which is the oracle for the golden tests.
 */

/** One `start[..stop][/repeat]` item in a field's comma-separated list. */
export interface Component {
  readonly start: number
  /** Inclusive end of a `..` range; equal to `start` for a single value. */
  readonly stop: number
  /** Repetition step; `0` when the component does not repeat. */
  readonly repeat: number
}

export interface CalendarSpec {
  /** Bitmask of weekdays, Monday = bit 0. `0x7f` (all days) when unrestricted. */
  readonly weekdays: number
  /** `null` means `*`. Seconds are in microseconds to support fractional values. */
  readonly year: readonly Component[] | null
  readonly month: readonly Component[] | null
  readonly day: readonly Component[] | null
  /** Day counts from the end of the month (`~` syntax). */
  readonly endOfMonth: boolean
  readonly hour: readonly Component[] | null
  readonly minute: readonly Component[] | null
  readonly microsecond: readonly Component[] | null
  /** `UTC`, an IANA zone name, or `null` for the evaluating zone. */
  readonly timeZone: string | null
}

export class CalendarSpecError extends Error {
  override readonly name = 'CalendarSpecError'
}

/** Parses an `OnCalendar=` expression. Throws {@link CalendarSpecError} on invalid input. */
export function parse(_expression: string): CalendarSpec {
  throw new CalendarSpecError('parse: not implemented')
}

/** Returns the normalized form, identical to `systemd-analyze calendar`'s "Normalized form". */
export function normalize(_spec: CalendarSpec | string): string {
  throw new CalendarSpecError('normalize: not implemented')
}

export interface NextOptions {
  /** Find elapses strictly after this instant. Defaults to now. */
  readonly after?: Date
  /** IANA zone used when the expression has none. Defaults to the runtime's zone. */
  readonly timeZone?: string
  /** Number of elapses to return. Defaults to 1. */
  readonly count?: number
}

/** Returns the next elapse times; fewer than `count` (possibly none) if the spec stops elapsing. */
export function next(_spec: CalendarSpec | string, _options?: NextOptions): Date[] {
  throw new CalendarSpecError('next: not implemented')
}

/** Describes the expression in plain English, e.g. "Every weekday at 09:00 in Europe/Tallinn". */
export function describe(_spec: CalendarSpec | string): string {
  throw new CalendarSpecError('describe: not implemented')
}
