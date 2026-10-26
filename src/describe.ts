/** English descriptions of calendar specs. systemd has no equivalent, so the wording is our own. */
import { parse } from './parse.ts'
import type { CalendarSpec, Component, ParseOptions } from './spec.ts'

const USEC_PER_SEC = 1_000_000
const ALL_WEEKDAYS = 0x7f
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
/** At most this many fixed times are listed one by one ("at 08:00, 12:00 and 18:00"). */
const MAX_LISTED_TIMES = 6

type Chain = readonly Component[] | null

function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Seconds from microseconds: `05`, `01.5`. */
function formatSeconds(usec: number): string {
  const fraction = usec % USEC_PER_SEC
  const whole = pad(Math.floor(usec / USEC_PER_SEC))
  return fraction > 0 ? `${whole}.${String(fraction).padStart(6, '0').replace(/0+$/, '')}` : whole
}

/** Seconds as a plain number: `5`, `1.5`. */
const plainSeconds = (usec: number): string => String(usec / USEC_PER_SEC)

function formatTime(h: number, m: number, usec: number, withSeconds: boolean): string {
  return `${pad(h)}:${pad(m)}${withSeconds ? `:${formatSeconds(usec)}` : ''}`
}

/** Single values only, no ranges or repeats. */
function singles(chain: Chain): number[] | null {
  if (!chain || chain.some((c) => c.stop !== null || c.repeat > 0)) return null
  return chain.map((c) => c.start)
}

interface Unit {
  readonly one: string
  readonly many: string
  /** The field's lowest value: an open repeat from there is just "every 15 minutes". */
  readonly min: number
  /** A range's implicit repeat: 1, or one second for seconds (in microseconds). */
  readonly step: number
  /** A value on its own: "minute 5", "the 5th", "January". */
  readonly label: (n: number) => string
  /** The end of a range, after "through": "35", "15th", "August". */
  readonly end: (n: number) => string
  /** Before an open repeat's start: "starting at minute 5", "starting in January". */
  readonly prep: string
  /** Before a list of values and ranges: "at minute 5 and …", "on the 1st through 7th". */
  readonly lead: string
  /** Values count down (days from the end of the month), so ranges read from `stop` to `start`. */
  readonly reversed?: boolean
  /** Fixed values: "at minutes 0 and 30", "on the 1st and 15th". */
  readonly fixed: (values: number[]) => string
  /** The repeat step: "every 15 minutes" or, for days, "every 2nd day". */
  readonly every: (step: number) => string
}

function everyCount(one: string, many: string): (step: number) => string {
  return (step) => (step === 1 ? `every ${one}` : `every ${step} ${many}`)
}

function everyOrdinal(one: string): (step: number) => string {
  return (step) => (step === 1 ? `every ${one}` : `every ${ordinal(step)} ${one}`)
}

const plural = (values: number[], one: string, many: string): string =>
  values.length === 1 ? one : many

const SECOND: Unit = {
  one: 'second',
  many: 'seconds',
  min: 0,
  step: USEC_PER_SEC,
  label: (n) => `second ${plainSeconds(n)}`,
  end: plainSeconds,
  prep: 'at',
  lead: 'at',
  fixed: (v) => `at ${plural(v, 'second', 'seconds')} ${list(v.map(plainSeconds))}`,
  every: (step) => (step === USEC_PER_SEC ? 'every second' : `every ${plainSeconds(step)} seconds`),
}

const MINUTE: Unit = {
  one: 'minute',
  many: 'minutes',
  min: 0,
  step: 1,
  label: (n) => `minute ${n}`,
  end: String,
  prep: 'at',
  lead: 'at',
  fixed: (v) => `at ${plural(v, 'minute', 'minutes')} ${list(v.map(String))}`,
  every: everyCount('minute', 'minutes'),
}

/** Hours when minutes or seconds repeat within them: "from 09:00 through 17:59". */
const HOUR: Unit = {
  one: 'hour',
  many: 'hours',
  min: 0,
  step: 1,
  label: (n) => `${pad(n)}:00`,
  end: (n) => `${pad(n)}:59`,
  prep: 'at',
  lead: 'from',
  fixed: (v) => `during ${plural(v, 'hour', 'hours')} ${list(v.map((n) => `${pad(n)}:00`))}`,
  every: everyCount('hour', 'hours'),
}

const DAY: Unit = {
  one: 'day',
  many: 'days',
  min: 1,
  step: 1,
  label: (n) => `the ${ordinal(n)}`,
  end: ordinal,
  prep: 'on',
  lead: 'on',
  fixed: (v) => `on the ${list(v.map(ordinal))}`,
  every: everyOrdinal('day'),
}

/** Day of the month counted from its end: 1 is the last day. */
const DAY_FROM_END: Unit = {
  one: 'day',
  many: 'days',
  min: 1,
  step: 1,
  label: (n) => (n === 1 ? 'the last day' : `the ${ordinal(n)}-to-last day`),
  end: (n) => (n === 1 ? 'the last day' : `the ${ordinal(n)}-to-last day`),
  prep: 'from',
  lead: 'on',
  reversed: true,
  fixed: (v) => `on ${list(v.map((n) => DAY_FROM_END.label(n)))}`,
  every: everyOrdinal('day'),
}

const monthName = (n: number): string => MONTHS[n - 1] ?? String(n)

const MONTH: Unit = {
  one: 'month',
  many: 'months',
  min: 1,
  step: 1,
  label: monthName,
  end: monthName,
  prep: 'in',
  lead: 'in',
  fixed: (v) => `in ${list(v.map(monthName))}`,
  every: everyCount('month', 'months'),
}

const YEAR: Unit = {
  one: 'year',
  many: 'years',
  min: 1970,
  step: 1,
  label: String,
  end: String,
  prep: 'in',
  lead: 'in',
  fixed: (v) => `in ${list(v.map(String))}`,
  every: everyCount('year', 'years'),
}

function describeComponent(c: Component, unit: Unit): string {
  const { start, stop, repeat } = c
  if (stop === null && repeat === 0) return unit.label(start)
  if (stop !== null) {
    const [from, to] = unit.reversed ? [stop, start] : [start, stop]
    const range = `${unit.label(from)} through ${unit.end(to)}`
    return repeat <= unit.step ? range : `${unit.every(repeat)} from ${range}`
  }
  return `${unit.every(repeat)} starting ${unit.prep} ${unit.label(start)}`
}

/** A whole field: "at minutes 0 and 30", "every 15 minutes", "every 5 minutes from minute 20 through 35". */
function describeChain(chain: readonly Component[], unit: Unit): string {
  const values = singles(chain)
  if (values) return unit.fixed(values)
  const [only] = chain
  if (chain.length === 1 && only?.stop === null && only.start === unit.min) {
    return unit.every(only.repeat)
  }
  const text = list(chain.map((c) => describeComponent(c, unit)))
  return text.startsWith('every ') ? text : `${unit.lead} ${text}`
}

/** The time of day: "at 09:00", "every 15 minutes", "every 2 hours from 09:00 through 17:00". */
function describeTime(spec: CalendarSpec): string {
  const hours = singles(spec.hour)
  const minutes = singles(spec.minute)
  const seconds = spec.microsecond === null ? null : singles(spec.microsecond)
  const withSeconds = seconds?.some((s) => s !== 0) ?? false

  // A few fixed times: list them.
  if (hours && minutes && seconds) {
    if (hours.length * minutes.length * seconds.length <= MAX_LISTED_TIMES) {
      const times = hours.flatMap((h) =>
        minutes.flatMap((m) => seconds.map((s) => formatTime(h, m, s, withSeconds))),
      )
      return `at ${list(times)}`
    }
  }

  // Fixed minutes and seconds in every hour: "every hour", "every hour at :15 and :45".
  if (spec.hour === null && minutes && seconds) {
    if (!withSeconds && minutes.length === 1 && minutes[0] === 0) return 'every hour'
    const marks = minutes.flatMap((m) =>
      seconds.map((s) => `:${pad(m)}${withSeconds ? `:${formatSeconds(s)}` : ''}`),
    )
    return `every hour at ${list(marks)}`
  }

  // One fixed minute and second in a pattern of hours: "every 2 hours from 09:15 through 17:15".
  if (spec.hour && minutes?.length === 1 && seconds?.length === 1) {
    const at = (h: number): string =>
      formatTime(h, minutes[0] as number, seconds[0] as number, withSeconds)
    const parts = spec.hour.map((c) =>
      c.stop !== null && c.repeat <= 1
        ? `every hour from ${at(c.start)} through ${at(c.stop)}`
        : describeComponent(c, { ...HOUR, label: at, end: at, prep: 'at' }),
    )
    const text = list(parts)
    return text.startsWith('every ') ? text : `at ${text}`
  }

  // Fixed seconds in every minute: "every minute", "every minute at second 1.5".
  if (spec.hour === null && spec.minute === null && seconds) {
    return withSeconds || seconds.length > 1
      ? `every minute ${SECOND.fixed(seconds)}`
      : 'every minute'
  }

  const parts: string[] = []
  if (spec.microsecond === null) parts.push('every second')
  else if (!(seconds?.length === 1 && seconds[0] === 0)) {
    parts.push(describeChain(spec.microsecond, SECOND))
  }
  if (spec.minute !== null) parts.push(describeChain(spec.minute, MINUTE))
  else if (parts.length === 0) parts.push('every minute')
  // Seconds within every minute: "every minute at seconds 1 through 3".
  else if (!parts[0]?.startsWith('every ')) parts.unshift('every minute')
  if (spec.hour) parts.push(describeChain(spec.hour, HOUR))
  return parts.join(' ')
}

function describeWeekdays(bits: number): string {
  const runs: string[] = []
  let x = 0
  while (x < 7) {
    if (!(bits & (1 << x))) {
      x++
      continue
    }
    let end = x
    while (end + 1 < 7 && bits & (1 << (end + 1))) end++
    if (end - x >= 2) runs.push(`${WEEKDAYS[x]} through ${WEEKDAYS[end]}`)
    else for (let d = x; d <= end; d++) runs.push(WEEKDAYS[d] as string)
    x = end + 1
  }
  return list(runs)
}

/** The days: "on the 1st of every month", "on Monday through Friday", "on 2026-11-05". */
function describeDate(spec: CalendarSpec): string {
  const weekdays = spec.weekdays > 0 && spec.weekdays < ALL_WEEKDAYS ? spec.weekdays : null
  const years = singles(spec.year)
  const months = singles(spec.month)
  const days = spec.endOfMonth ? null : singles(spec.day)
  const parts: string[] = []
  const weekdayCondition = weekdays === null ? null : `if it is a ${describeWeekdays(weekdays)}`

  if (years?.length === 1 && months?.length === 1 && days?.length === 1) {
    parts.push(`on ${years[0]}-${pad(months[0] as number)}-${pad(days[0] as number)}`)
    if (weekdayCondition) parts.push(weekdayCondition)
    return parts.join(' ')
  }

  // `Mon *-*~07/1`: the one Monday among the last seven days of the month.
  const first = spec.day?.[0]
  const lastWeekday =
    spec.endOfMonth &&
    spec.day?.length === 1 &&
    first?.start === 7 &&
    first.stop === null &&
    first.repeat === 1 &&
    weekdays !== null &&
    (weekdays & (weekdays - 1)) === 0

  let dayText: string | null = null
  if (lastWeekday) dayText = `on the last ${WEEKDAYS[Math.log2(weekdays as number)]}`
  else if (spec.endOfMonth && first?.start === 1 && first.stop !== null && spec.day?.length === 1) {
    dayText = first.repeat <= 1 ? `on the last ${first.stop} days` : null
  }
  if (dayText === null && spec.day) {
    dayText = describeChain(spec.day, spec.endOfMonth ? DAY_FROM_END : DAY)
    if (dayText.startsWith('every ')) dayText = `on ${dayText}`
  }

  if (dayText !== null) {
    if (months?.length === 1 && days) {
      // "on January 1 and 15"
      dayText = `on ${MONTHS[(months[0] as number) - 1]} ${list(days.map(String))}`
    } else if (spec.month === null) dayText += ' of every month'
    else if (months) dayText += ` of ${list(months.map((m) => MONTH.label(m)))}`
    else dayText += `, ${describeChain(spec.month, MONTH)}`
    parts.push(dayText)
    if (weekdayCondition && !lastWeekday) parts.push(weekdayCondition)
  } else {
    if (weekdays !== null) parts.push(`on ${describeWeekdays(weekdays)}`)
    if (spec.month) parts.push(describeChain(spec.month, MONTH))
  }
  if (spec.year) parts.push(describeChain(spec.year, YEAR))
  return parts.join(' ')
}

/**
 * Describes the expression in plain English, e.g. "At 09:00 on Monday through Friday (Europe/Tallinn)".
 * `options.timeZone` matters only for zone abbreviations, as in {@link parse}.
 */
export function describe(spec: CalendarSpec | string, options?: ParseOptions): string {
  const s = typeof spec === 'string' ? parse(spec, options) : spec
  const time = describeTime(s)
  const date = describeDate(s)
  // A fixed time with no day restriction happens every day ("at 00:00 every day in June").
  const everyDay = time.startsWith('at ') && !/^on /.test(date)
  let text = [time, everyDay ? 'every day' : '', date].filter((p) => p !== '').join(' ')
  if (s.timeZone !== null) text += ` (${s.timeZone})`
  return text.charAt(0).toUpperCase() + text.slice(1)
}
