/**
 * Next elapse, following calendar_spec_next_usec() and find_next() in systemd's
 * src/shared/calendarspec.c, on top of an emulation of glibc's mktime() (see mktime.ts).
 */
import { gmtime, localtime, type MktimeState, mktime, type Tm, timegm } from './mktime.ts'
import { parse } from './parse.ts'
import type { CalendarSpec, Component, NextOptions } from './spec.ts'
import { defaultTimeZone, getZone, UTC_ZONE, type Zone } from './zone.ts'

const USEC_PER_SEC = 1_000_000
const MAX_YEAR = 2199
/** systemd gives up after this many steps (MAX_CALENDAR_ITERATIONS). */
const MAX_ITERATIONS = 1000
const ALL_WEEKDAYS = 0x7f
/** `*` seconds: every whole second. */
const EVERY_SECOND: readonly Component[] = [{ start: 0, stop: null, repeat: USEC_PER_SEC }]

class NoElapse extends Error {}

interface Context {
  readonly spec: CalendarSpec
  readonly utc: boolean
  readonly zone: Zone
  readonly state: MktimeState
}

/** systemd's mktime_or_timegm_usec(): normalizes `tm` in place; `false` on error or before 1970. */
function normalizeTm(ctx: Context, tm: Tm): boolean {
  if (tm.year < 1969) return false
  const t = ctx.utc ? timegm(tm) : mktime(tm, ctx.zone, ctx.state)
  return t !== null && t >= 0
}

/** The day `day` days before the end of `tm`'s month, or -1 (find_end_of_month()). */
function endOfMonth(ctx: Context, tm: Tm, day: number): number {
  const t = { ...tm, mon: tm.mon + 1, mday: 1 - day }
  if (!normalizeTm(ctx, t) || t.mon !== tm.mon) return -1
  return t.mday
}

/**
 * The earliest value `>= value` matching one of the components, or `null` if none does
 * (find_matching_component()).
 */
function findMatching(
  ctx: Context,
  chain: readonly Component[] | null,
  isDay: boolean,
  tm: Tm,
  value: number,
): number | null {
  if (!chain) return value
  const fromEnd = ctx.spec.endOfMonth && isDay
  let best: number | null = null
  for (const c of chain) {
    let start = c.start
    let stop = c.stop ?? -1
    if (fromEnd) {
      start = endOfMonth(ctx, tm, c.start)
      stop = endOfMonth(ctx, tm, c.stop ?? -1)
      if (stop > 0) [start, stop] = [stop, start]
    }
    if (start >= value) {
      if (best === null || start < best) best = start
    } else if (c.repeat > 0) {
      const k = start + c.repeat * Math.ceil((value - start) / c.repeat)
      if ((best === null || k < best) && (stop < 0 || k <= stop)) best = k
    }
  }
  return best
}

/** Compares broken-down times field by field (tm_compare()). */
function compareTm(a: Tm, b: Tm): number {
  return (
    Math.sign(a.year - b.year) ||
    Math.sign(a.mon - b.mon) ||
    Math.sign(a.mday - b.mday) ||
    Math.sign(a.hour - b.hour) ||
    Math.sign(a.min - b.min) ||
    Math.sign(a.sec - b.sec)
  )
}

/**
 * tm_within_bounds(): 1 if `tm` is already normalized, 0 if normalizing moved it forward (and `tm` now
 * holds the normalized time with lower fields reset), or `null` for an error or a backward move.
 */
function withinBounds(ctx: Context, tm: Tm): 0 | 1 | null {
  // Stop at the last supported year, so dates that never occur (*-02-31) end the search.
  if (tm.year > MAX_YEAR) return null
  const t = { ...tm }
  if (!normalizeTm(ctx, t)) return null
  // Reset the unit below the first one that normalization changed.
  const cmp = compareTm(t, tm)
  if (t.year !== tm.year) {
    t.mon = 0
    t.mday = 1
  } else if (t.mon !== tm.mon) t.mday = 1
  else if (t.mday !== tm.mday) t.hour = 0
  else if (t.hour !== tm.hour) t.min = 0
  else if (t.min !== tm.min) t.sec = 0
  // Normalizing to an earlier time is a failure.
  if (cmp < 0) return null
  if (cmp > 0) Object.assign(tm, t)
  return cmp === 0 ? 1 : 0
}

function matchesWeekday(ctx: Context, tm: Tm): boolean {
  const bits = ctx.spec.weekdays
  if (bits <= 0 || bits >= ALL_WEEKDAYS) return true
  const t = { ...tm }
  if (!normalizeTm(ctx, t)) return false
  const k = t.wday === 0 ? 6 : t.wday - 1
  return (bits & (1 << k)) !== 0
}

/**
 * find_next(): the first matching time at or after `tm` plus `usec` microseconds, as broken-down time
 * and microseconds. Throws {@link NoElapse} if there is none.
 */
function findNext(ctx: Context, tm: Tm, usec: number): [Tm, number] {
  const { spec } = ctx
  const dst = spec.dst === null ? -1 : spec.dst ? 1 : 0
  const c = { ...tm }
  let tmUsec = usec
  let invalidateDst = false
  const resetFrom = (field: 'mon' | 'mday' | 'hour' | 'min' | 'sec'): void => {
    // Resets `field` and everything below it to its lowest value.
    const order = ['mon', 'mday', 'hour', 'min', 'sec'] as const
    for (const f of order.slice(order.indexOf(field))) c[f] = f === 'mday' ? 1 : 0
    tmUsec = 0
  }

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    normalizeTm(ctx, c)
    if (!invalidateDst) c.isdst = dst

    let v = findMatching(ctx, spec.year, false, c, c.year)
    if (v === null) throw new NoElapse()
    if (v !== c.year) {
      c.year = v
      resetFrom('mon')
    }
    let r = withinBounds(ctx, c)
    if (r !== 1) throw new NoElapse()

    v = findMatching(ctx, spec.month, false, c, c.mon + 1)
    if (v !== null && v !== c.mon + 1) {
      c.mon = v - 1
      resetFrom('mday')
    }
    r = v === null ? null : withinBounds(ctx, c)
    if (r === null) {
      c.year++
      resetFrom('mon')
      continue
    }
    if (r === 0) continue

    v = findMatching(ctx, spec.day, true, c, c.mday)
    if (v !== null && v !== c.mday) {
      c.mday = v
      resetFrom('hour')
    }
    r = v === null ? null : withinBounds(ctx, c)
    if (r === null) {
      c.mon++
      resetFrom('mday')
      continue
    }
    if (r === 0) continue

    if (!matchesWeekday(ctx, c)) {
      c.mday++
      resetFrom('hour')
      continue
    }

    v = findMatching(ctx, spec.hour, false, c, c.hour)
    if (v !== null && v !== c.hour) {
      c.hour = v
      resetFrom('min')
    }
    r = v === null ? null : withinBounds(ctx, c)
    if (r === null) {
      c.mday++
      resetFrom('hour')
      continue
    }
    // 0: the hour was skipped by a DST change and normalized forward; search again from there.
    if (r === 0) continue

    v = findMatching(ctx, spec.minute, false, c, c.min)
    if (v !== null && v !== c.min) {
      c.min = v
      resetFrom('sec')
    }
    r = v === null ? null : withinBounds(ctx, c)
    if (r === null) {
      c.hour++
      resetFrom('min')
      continue
    }
    if (r === 0) continue

    const current = c.sec * USEC_PER_SEC + tmUsec
    v = findMatching(ctx, spec.microsecond ?? EVERY_SECOND, false, c, current)
    if (v !== null) {
      tmUsec = v % USEC_PER_SEC
      c.sec = Math.floor(v / USEC_PER_SEC)
    }
    r = v === null ? null : withinBounds(ctx, c)
    if (r === null) {
      c.min++
      resetFrom('sec')
      continue
    }
    if (r === 0) continue

    // Not past the starting point, e.g. after mktime() moved back across a DST change: advance and let
    // mktime() pick the DST state from now on.
    let cmp = compareTm(tm, c)
    if (cmp === 0) cmp = Math.sign(usec - (tmUsec + 1))
    if (cmp >= 0) {
      invalidateDst = true
      c.hour++
      continue
    }
    return [c, tmUsec]
  }
  // systemd logs "Infinite loop in calendar calculation" and gives up.
  throw new NoElapse()
}

/** calendar_spec_next_usec(): the next elapse strictly after `usec`, in microseconds. */
function nextUsec(ctx: Context, after: number): number | null {
  const usec = after + 1
  const t = Math.floor(usec / USEC_PER_SEC)
  const start = ctx.utc ? gmtime(t) : localtime(t, ctx.zone)
  try {
    const [tm, tmUsec] = findNext(ctx, start, usec % USEC_PER_SEC)
    const result = ctx.utc ? timegm(tm) : mktime(tm, ctx.zone, ctx.state)
    return result === null || result < 0 ? null : result * USEC_PER_SEC + tmUsec
  } catch (e) {
    if (e instanceof NoElapse) return null
    throw e
  }
}

/** Returns the next elapse times; fewer than `count` (possibly none) if the spec stops elapsing. */
export function next(spec: CalendarSpec | string, options: NextOptions = {}): Date[] {
  const localZone = options.timeZone ?? defaultTimeZone()
  const parsed = typeof spec === 'string' ? parse(spec, { timeZone: localZone }) : spec
  const utc = parsed.timeZone === 'UTC'
  const named = parsed.timeZone !== null && parsed.dst === null
  const zone = utc ? UTC_ZONE : getZone(named ? (parsed.timeZone as string) : localZone)
  // glibc's mktime() guess carries over between elapses, as within one systemd-analyze run.
  const ctx: Context = { spec: parsed, utc, zone, state: { offset: 0 } }

  const count = options.count ?? 1
  const result: Date[] = []
  let after = (options.after ?? new Date()).getTime() * 1000
  while (result.length < count) {
    const elapse = nextUsec(ctx, after)
    if (elapse === null) break
    result.push(new Date(Math.floor(elapse / 1000)))
    after = elapse
  }
  return result
}
