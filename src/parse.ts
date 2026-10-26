/**
 * Parser for calendar expressions, following calendar_spec_from_string() in systemd's
 * src/shared/calendarspec.c step by step so that accepted and rejected inputs match.
 */
import {
  type CalendarSpec,
  CalendarSpecError,
  type CalendarSpecErrorCode,
  type Component,
  type ParseOptions,
} from './spec.ts'
import { defaultTimeZone, isValidTimeZone, zoneAbbreviations } from './zone.ts'

const USEC_PER_SEC = 1_000_000
const INT_MAX = 2_147_483_647
/** systemd rejects more than this many list items in one field (CALENDARSPEC_COMPONENTS_MAX). */
const COMPONENTS_MAX = 240
const MIN_YEAR = 1970
const MAX_YEAR = 2199
const ALL_WEEKDAYS = 0x7f

/** A component as systemd stores it: `stop` is -1 when there is no range. */
interface Item {
  start: number
  stop: number
  repeat: number
}

/** `null` means `*`. */
type Chain = Item[] | null

const single = (...values: number[]): Item[] =>
  values.map((start) => ({ start, stop: -1, repeat: 0 }))

interface Draft {
  weekdays: number
  year: Chain
  month: Chain
  day: Chain
  endOfMonth: boolean
  hour: Chain
  minute: Chain
  microsecond: Chain
  utc: boolean
  timeZone: string | null
  dst: boolean | null
}

class Fail extends Error {
  readonly code: CalendarSpecErrorCode
  constructor(code: CalendarSpecErrorCode = 'EINVAL') {
    super(code)
    this.code = code
  }
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9'

/** A read position in the input, standing in for C's `const char **p`. */
class Cursor {
  constructor(
    readonly text: string,
    public pos = 0,
  ) {}

  get char(): string {
    return this.text[this.pos] ?? ''
  }

  at(offset: number): string {
    return this.text[this.pos + offset] ?? ''
  }

  get atEnd(): boolean {
    return this.pos >= this.text.length
  }

  skipSpaces(): void {
    while (this.char === ' ') this.pos++
  }

  clone(): Cursor {
    return new Cursor(this.text, this.pos)
  }
}

const WEEKDAY_NAMES: readonly (readonly [string, number])[] = [
  ['Monday', 0],
  ['Mon', 0],
  ['Tuesday', 1],
  ['Tue', 1],
  ['Wednesday', 2],
  ['Wed', 2],
  ['Thursday', 3],
  ['Thu', 3],
  ['Friday', 4],
  ['Fri', 4],
  ['Saturday', 5],
  ['Sat', 5],
  ['Sunday', 6],
  ['Sun', 6],
]

function startsWithNoCase(c: Cursor, prefix: string): boolean {
  return c.text.slice(c.pos, c.pos + prefix.length).toLowerCase() === prefix.toLowerCase()
}

function parseWeekdays(c: Cursor, d: Draft): void {
  let rangeStart = -1
  let first = true
  for (;;) {
    const found = WEEKDAY_NAMES.find(([name]) => startsWithNoCase(c, name))
    if (!found) {
      // No weekday here: assume the expression doesn't restrict weekdays and go on with the date.
      if (first) return
      throw new Fail()
    }
    const [name, nr] = found
    if (!['', '-', '.', ',', ' '].includes(c.at(name.length))) throw new Fail()
    d.weekdays |= 1 << nr
    if (rangeStart >= 0) {
      if (rangeStart > nr) throw new Fail()
      for (let j = rangeStart + 1; j < nr; j++) d.weekdays |= 1 << j
    }
    c.pos += name.length

    if (c.atEnd) return
    if (c.char === ' ') {
      c.skipSpaces()
      return
    }
    if (c.char === '.') {
      if (rangeStart >= 0 || c.at(1) !== '.') throw new Fail()
      rangeStart = nr
      c.pos += 2
    } else if (c.char === '-') {
      // `-` ranges are kept for backwards compatibility.
      if (rangeStart >= 0) throw new Fail()
      rangeStart = nr
      c.pos += 1
    } else if (c.char === ',') {
      rangeStart = -1
      c.pos += 1
    }

    // A trailing comma is fine, an open range is not.
    if (c.atEnd || c.char === ' ') {
      c.skipSpaces()
      if (rangeStart >= 0) throw new Fail()
      return
    }
    first = false
  }
}

/** Reads digits as `strtoul` would, plus a fraction for seconds, into an integer (µs for seconds). */
function parseDecimal(c: Cursor, usec: boolean): number {
  if (!isDigit(c.char)) throw new Fail()
  const begin = c.pos
  while (isDigit(c.char)) c.pos++
  let value = Number(c.text.slice(begin, c.pos))
  if (value > INT_MAX) throw new Fail('ERANGE')
  if (usec) {
    value *= USEC_PER_SEC
    // One `.` is a decimal point, `..` is a range.
    if (c.char === '.' && c.at(1) !== '.') {
      c.pos++
      value += parseFraction(c)
    }
  }
  if (value > INT_MAX) throw new Fail('ERANGE')
  return value
}

/** Six digits of fraction, rounded half up on the seventh; further digits are ignored. */
function parseFraction(c: Cursor): number {
  let value = 0
  let i = 0
  for (; i < 6; i++) {
    if (!isDigit(c.char)) {
      if (i === 0) throw new Fail()
      break
    }
    value = value * 10 + Number(c.char)
    c.pos++
  }
  for (; i < 6; i++) value *= 10
  if (c.char >= '5' && c.char <= '9') value++
  while (isDigit(c.char)) c.pos++
  return value
}

function parseComponents(c: Cursor, usec: boolean): Item[] {
  const items: Item[] = []
  for (;;) {
    if (items.length > COMPONENTS_MAX) throw new Fail('ENOBUFS')
    const start = parseDecimal(c, usec)
    let stop = -1
    let repeat = 0
    if (c.char === '.' && c.at(1) === '.') {
      c.pos += 2
      stop = parseDecimal(c, usec)
      repeat = usec ? USEC_PER_SEC : 1
    }
    if (c.char === '/') {
      c.pos++
      repeat = parseDecimal(c, usec)
      if (repeat === 0) throw new Fail('ERANGE')
    } else {
      if (start > INT_MAX - repeat) throw new Fail('ERANGE')
      // Without an explicit repeat, a seconds range must span at least one whole second.
      if (usec && stop >= 0 && start + repeat > stop) throw new Fail()
    }
    if (!['', ' ', ',', '-', '~', ':'].includes(c.char)) throw new Fail()
    items.push({ start, stop, repeat })
    if (c.char !== ',') return items
    c.pos++
  }
}

function parseChain(c: Cursor, usec: boolean): Chain {
  if (c.char === '*') {
    c.pos++
    // `*` seconds means every whole second, which systemd stores as 0/1.
    return usec ? [{ start: 0, stop: -1, repeat: USEC_PER_SEC }] : null
  }
  return parseComponents(c, usec)
}

/** Parses `@seconds`. systemd uses an unsigned parser: whitespace and `+` are fine, `-` is ERANGE. */
function parseEpoch(c: Cursor, d: Draft): void {
  const m = /^\s*([+-]?)(\d+)$/.exec(c.text.slice(c.pos + 1))
  if (!m) throw new Fail()
  if (m[1] === '-') throw new Fail('ERANGE')
  if (BigInt(m[2] as string) > 0xffff_ffff_ffff_ffffn) throw new Fail('ERANGE')
  // Anything past the year 2199 fails validation later; Date covers far more than that.
  const date = new Date(Math.min(Number(m[2]), 8.64e12) * 1000)
  d.year = single(date.getUTCFullYear())
  d.month = single(date.getUTCMonth() + 1)
  d.day = single(date.getUTCDate())
  d.hour = single(date.getUTCHours())
  d.minute = single(date.getUTCMinutes())
  d.microsecond = single(date.getUTCSeconds() * USEC_PER_SEC)
  d.utc = true
  d.timeZone = null
  d.dst = null
  c.pos = c.text.length
}

/** Returns true when it consumed a complete `@epoch`, so no time follows. */
function parseDate(c: Cursor, d: Draft): boolean {
  if (c.atEnd) return false
  if (c.char === '@') {
    parseEpoch(c, d)
    return true
  }
  const t = c.clone()
  const first = parseChain(t, false)
  // Already at the end, or a `:`: this was a time, not a date.
  if (t.atEnd || t.char === ':') return false

  if (t.char === '~') d.endOfMonth = true
  else if (t.char !== '-') throw new Fail()
  t.pos++
  const second = parseChain(t, false)

  // Two parts: month and day. (`at(0)`, not `char`: TypeScript would keep the narrowing from above.)
  if (t.atEnd || t.at(0) === ' ') {
    t.skipSpaces()
    c.pos = t.pos
    d.month = first
    d.day = second
    return false
  }
  if (d.endOfMonth) throw new Fail()

  if (t.char === '~') d.endOfMonth = true
  else if (t.char !== '-') throw new Fail()
  t.pos++
  const third = parseChain(t, false)
  if (!(t.atEnd || t.at(0) === ' ')) throw new Fail()

  t.skipSpaces()
  c.pos = t.pos
  d.year = first
  d.month = second
  d.day = third
  return false
}

function parseTime(c: Cursor, d: Draft): void {
  // No time at all means 00:00:00.
  if (c.atEnd) {
    d.hour = single(0)
    d.minute = single(0)
    d.microsecond = single(0)
    return
  }
  d.hour = parseChain(c, false)
  if (c.char !== ':') throw new Fail()
  c.pos++
  d.minute = parseChain(c, false)
  // Hours and minutes only: seconds are 0.
  if (c.atEnd) {
    d.microsecond = single(0)
    return
  }
  if (c.char !== ':') throw new Fail()
  c.pos++
  d.microsecond = parseChain(c, true)
  if (!c.atEnd) throw new Fail()
}

interface Shorthand {
  readonly weekdays?: number
  readonly month?: readonly number[]
  readonly day?: readonly number[]
  /** Fields left as `*`; the others are 0. */
  readonly every?: 'minute' | 'hour'
}

const YEARLY: Shorthand = { month: [1], day: [1] }
const SEMIANNUALLY: Shorthand = { month: [1, 7], day: [1] }

const SHORTHANDS: ReadonlyMap<string, Shorthand> = new Map([
  ['minutely', { every: 'minute' }],
  ['hourly', { every: 'hour' }],
  ['daily', {}],
  ['weekly', { weekdays: 1 }],
  ['monthly', { day: [1] }],
  ['quarterly', { month: [1, 4, 7, 10], day: [1] }],
  ['yearly', YEARLY],
  ['annually', YEARLY],
  ['anually', YEARLY],
  ['semiannually', SEMIANNUALLY],
  ['semi-annually', SEMIANNUALLY],
  ['biannually', SEMIANNUALLY],
  ['bi-annually', SEMIANNUALLY],
])

function applyShorthand(s: Shorthand, d: Draft): void {
  d.weekdays = s.weekdays ?? 0
  d.month = s.month ? single(...s.month) : null
  d.day = s.day ? single(...s.day) : null
  d.hour = s.every ? null : single(0)
  d.minute = s.every === 'minute' ? null : single(0)
  d.microsecond = single(0)
}

function endsWithNoCase(text: string, suffix: string): boolean {
  return (
    text.length >= suffix.length &&
    text.slice(-suffix.length).toLowerCase() === suffix.toLowerCase()
  )
}

/** Strips a `UTC`, local abbreviation or IANA zone suffix. Returns the rest of the expression. */
function parseZone(text: string, d: Draft, localZone: string): string {
  if (endsWithNoCase(text, ' UTC')) {
    d.utc = true
    return text.slice(0, -4)
  }
  const names = zoneAbbreviations(localZone)
  if (names) {
    for (const [j, name] of names.entries()) {
      if (name === '' || !endsWithNoCase(text, name)) continue
      const end = text.length - name.length
      if (end === 0 || text[end - 1] !== ' ') continue
      d.dst = j === 1
      d.timeZone = name
      return text.slice(0, end - 1)
    }
  }
  const lastSpace = text.lastIndexOf(' ')
  if (lastSpace >= 0 && isValidTimeZone(text.slice(lastSpace + 1))) {
    d.timeZone = text.slice(lastSpace + 1)
    return text.slice(0, lastSpace)
  }
  return text
}

function fixYear(chain: Chain): void {
  // Two-digit years: 00-69 are 2000-2069, 70-99 are 1970-1999.
  const fix = (n: number): number => (n < 0 ? n : n < 70 ? n + 2000 : n < 100 ? n + 1900 : n)
  for (const item of chain ?? []) {
    item.start = fix(item.start)
    item.stop = fix(item.stop)
  }
}

const compareItems = (a: Item, b: Item): number =>
  a.start - b.start || a.stop - b.stop || a.repeat - b.repeat

/** systemd's normalize_chain(): trims range ends, drops useless repeats, sorts and deduplicates. */
function normalizeChain(chain: Chain): Chain {
  if (!chain) return chain
  for (const i of chain) {
    if (i.repeat > 0 && i.stop > i.start) i.stop -= (i.stop - i.start) % i.repeat
    if ((i.stop > i.start && i.repeat > 0 && i.start + i.repeat > i.stop) || i.start === i.stop) {
      i.repeat = 0
      i.stop = -1
    }
  }
  const sorted = [...chain].sort(compareItems)
  return sorted.filter((item, k) => k === 0 || compareItems(item, sorted[k - 1] as Item) !== 0)
}

function chainValid(chain: Chain, from: number, to: number, endOfMonth: boolean): boolean {
  for (const i of chain ?? []) {
    if (i.start < from || i.start > to) return false
    if (i.repeat > to - from) return false
    // The repeat must fire at least once within the field's range.
    if (i.start + i.repeat > to && !endOfMonth) return false
    // Counting back from the end of the month, an open repeat must step past the first day.
    if (endOfMonth && i.repeat > 0 && i.stop < 0 && i.start <= i.repeat) return false
    if (i.stop >= 0 && (i.stop < from || i.stop > to || i.stop < i.start)) return false
  }
  return true
}

function specValid(d: Draft): boolean {
  return (
    chainValid(d.year, MIN_YEAR, MAX_YEAR, false) &&
    chainValid(d.month, 1, 12, false) &&
    chainValid(d.day, 1, d.endOfMonth ? 28 : 31, d.endOfMonth) &&
    chainValid(d.hour, 0, 23, false) &&
    chainValid(d.minute, 0, 59, false) &&
    chainValid(d.microsecond, 0, 60 * USEC_PER_SEC - 1, false)
  )
}

function toComponents(chain: Chain): readonly Component[] | null {
  return (
    chain &&
    chain.map(({ start, stop, repeat }) => ({ start, stop: stop < 0 ? null : stop, repeat }))
  )
}

function parseDraft(expression: string, localZone: string): Draft {
  if (expression === '') throw new Fail()
  const d: Draft = {
    weekdays: 0,
    year: null,
    month: null,
    day: null,
    endOfMonth: false,
    hour: null,
    minute: null,
    microsecond: null,
    utc: false,
    timeZone: null,
    dst: null,
  }
  const text = parseZone(expression, d, localZone)
  if (text === '') throw new Fail()

  const shorthand = SHORTHANDS.get(text.toLowerCase())
  if (shorthand) {
    applyShorthand(shorthand, d)
  } else {
    const c = new Cursor(text)
    parseWeekdays(c, d)
    if (!parseDate(c, d)) parseTime(c, d)
    if (!c.atEnd) throw new Fail()
  }

  if (d.weekdays <= 0 || d.weekdays >= ALL_WEEKDAYS) d.weekdays = ALL_WEEKDAYS
  if (d.endOfMonth && !d.day) d.endOfMonth = false
  fixYear(d.year)
  d.year = normalizeChain(d.year)
  d.month = normalizeChain(d.month)
  d.day = normalizeChain(d.day)
  d.hour = normalizeChain(d.hour)
  d.minute = normalizeChain(d.minute)
  d.microsecond = normalizeChain(d.microsecond)
  if (!specValid(d)) throw new Fail()
  return d
}

/** Parses an `OnCalendar=` expression. Throws {@link CalendarSpecError} on invalid input. */
export function parse(expression: string, options: ParseOptions = {}): CalendarSpec {
  let d: Draft
  try {
    d = parseDraft(expression, options.timeZone ?? defaultTimeZone())
  } catch (e) {
    if (e instanceof Fail) {
      throw new CalendarSpecError(
        `Invalid calendar expression: ${JSON.stringify(expression)}`,
        e.code,
      )
    }
    throw e
  }
  const sec = d.microsecond
  const everySecond =
    sec?.length === 1 && sec[0]?.start === 0 && sec[0].stop < 0 && sec[0].repeat === USEC_PER_SEC
  return {
    weekdays: d.weekdays,
    year: toComponents(d.year),
    month: toComponents(d.month),
    day: toComponents(d.day),
    endOfMonth: d.endOfMonth,
    hour: toComponents(d.hour),
    minute: toComponents(d.minute),
    microsecond: everySecond ? null : toComponents(sec),
    timeZone: d.utc ? 'UTC' : d.timeZone,
    dst: d.utc ? null : d.dst,
  }
}
