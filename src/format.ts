/** Formats a spec like calendar_spec_to_string() in systemd's src/shared/calendarspec.c. */
import { parse } from './parse.ts'
import type { CalendarSpec, Component, ParseOptions } from './spec.ts'

const USEC_PER_SEC = 1_000_000
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const ALL_WEEKDAYS = 0x7f

/** Runs of three or more days become `Mon..Wed`; pairs stay `Sat,Sun`. */
function formatWeekdays(bits: number): string {
  const runs: string[] = []
  let x = 0
  while (x < 7) {
    if (!(bits & (1 << x))) {
      x++
      continue
    }
    let end = x
    while (end + 1 < 7 && bits & (1 << (end + 1))) end++
    const length = end - x + 1
    if (length === 1) runs.push(DAYS[x] as string)
    else if (length === 2) runs.push(`${DAYS[x]},${DAYS[end]}`)
    else runs.push(`${DAYS[x]}..${DAYS[end]}`)
    x = end + 1
  }
  return runs.join(',')
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

function formatNumber(n: number, width: number, usec: boolean): string {
  if (!usec) return pad(n, width)
  const fraction = n % USEC_PER_SEC
  const whole = pad(Math.floor(n / USEC_PER_SEC), width)
  return fraction > 0 ? `${whole}.${pad(fraction, 6)}` : whole
}

function formatChain(chain: readonly Component[] | null, width: number, usec = false): string {
  if (!chain) return '*'
  const unit = usec ? USEC_PER_SEC : 1
  return chain
    .map(({ start, stop, repeat }) => {
      let s = formatNumber(start, width, usec)
      if (stop !== null && stop > 0) s += `..${formatNumber(stop, width, usec)}`
      // A range's implicit step of 1 is not printed.
      if (repeat > 0 && !(stop !== null && stop > 0 && repeat === unit)) {
        s += `/${formatNumber(repeat, 0, usec)}`
      }
      return s
    })
    .join(',')
}

export function formatSpec(spec: CalendarSpec): string {
  let s = ''
  if (spec.weekdays > 0 && spec.weekdays < ALL_WEEKDAYS) s += `${formatWeekdays(spec.weekdays)} `
  s += `${formatChain(spec.year, 4)}-${formatChain(spec.month, 2)}`
  s += `${spec.endOfMonth ? '~' : '-'}${formatChain(spec.day, 2)} `
  s += `${formatChain(spec.hour, 2)}:${formatChain(spec.minute, 2)}:`
  s += formatChain(spec.microsecond, 2, true)
  if (spec.timeZone !== null) s += ` ${spec.timeZone}`
  return s
}

/** Returns the normalized form, identical to `systemd-analyze calendar`'s "Normalized form". */
export function normalize(spec: CalendarSpec | string, options?: ParseOptions): string {
  return formatSpec(typeof spec === 'string' ? parse(spec, options) : spec)
}
