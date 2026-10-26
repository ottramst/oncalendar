/**
 * glibc's `mktime()`, `localtime()` and `timegm()` over a {@link Zone}.
 *
 * systemd's next-elapse search calls `mktime()` repeatedly and depends on its exact behaviour for times
 * that don't exist (spring-forward gaps) or exist twice (fall-back overlaps): glibc resolves those using
 * the offset its previous call ended up with. This follows `__mktime_internal()` in glibc's
 * time/mktime.c, including that cached offset, so the results match.
 */
import type { Zone } from './zone.ts'

/** `struct tm` with a full year and 0-based month. Fields may be out of range before normalizing. */
export interface Tm {
  year: number
  mon: number
  mday: number
  hour: number
  min: number
  sec: number
  /** -1 lets mktime decide. */
  isdst: number
  /** 0 = Sunday. Output only. */
  wday: number
}

/** glibc's static guess for the next call: the UTC offset the previous call settled on. */
export interface MktimeState {
  offset: number
}

const DAY = 86_400

/** Days since 1970-01-01 for a proleptic Gregorian date; month may be out of range. */
function daysFromCivil(year: number, mon: number, mday: number): number {
  const y = year + Math.floor(mon / 12)
  const m = ((mon % 12) + 12) % 12
  return Date.UTC(y, m, 1) / 1000 / DAY + mday - 1
}

/** Seconds since the epoch if the fields were UTC. */
function fieldsToSeconds(tm: Tm): number {
  return daysFromCivil(tm.year, tm.mon, tm.mday) * DAY + tm.hour * 3600 + tm.min * 60 + tm.sec
}

function breakDown(local: number, isdst: number): Tm {
  const d = new Date(local * 1000)
  return {
    year: d.getUTCFullYear(),
    mon: d.getUTCMonth(),
    mday: d.getUTCDate(),
    hour: d.getUTCHours(),
    min: d.getUTCMinutes(),
    sec: d.getUTCSeconds(),
    isdst,
    wday: d.getUTCDay(),
  }
}

export function gmtime(t: number): Tm {
  return breakDown(t, 0)
}

export function localtime(t: number, zone: Zone): Tm {
  return breakDown(t + zone.offset(t), zone.isDst(t) ? 1 : 0)
}

/** Normalizes `tm` in place and returns its unix time. */
export function timegm(tm: Tm): number {
  const t = fieldsToSeconds(tm)
  Object.assign(tm, gmtime(t))
  return t
}

const STRIDE = 601_200
const DELTA_BOUND = 457_243_200 / 2 + STRIDE

/**
 * Normalizes `tm` in place and returns its unix time, or `null` where glibc returns -1 (and leaves
 * `tm` alone).
 */
export function mktime(tm: Tm, zone: Zone, state: MktimeState): number | null {
  const requested = fieldsToSeconds(tm)
  const isdst = tm.isdst
  const t0 = requested - state.offset
  let t = t0
  let t1 = t0
  let t2 = t0
  let probes = 6
  let found = false
  for (;;) {
    const dt = requested - (t + zone.offset(t))
    if (dt === 0) break
    // Oscillating between two values: the time falls in a spring-forward gap. glibc returns the
    // candidate whose tm_isdst differs from the requested one or, if none was requested, the DST one.
    // Either way the result lands the gap's size away from the requested time, usually forward.
    if (t === t1 && t !== t2) {
      const wanted = isdst < 0 ? true : isdst === 0
      if (zone.isDst(t) !== wanted && zone.isDst(t2) === wanted) t = t2
      found = true
      break
    }
    if (--probes === 0) return null
    t1 = t2
    t2 = t
    t += dt
  }

  if (!found && isdst >= 0 && (isdst !== 0) !== zone.isDst(t)) {
    // Wrong tm_isdst: use the offset of a nearby time that has the requested one.
    let shifted: number | null = null
    search: for (let delta = STRIDE; delta < DELTA_BOUND; delta += STRIDE) {
      for (const direction of [-1, 1]) {
        const ot = t + delta * direction
        if ((isdst !== 0) === zone.isDst(ot)) {
          shifted = requested - zone.offset(ot)
          break search
        }
      }
    }
    if (shifted === null) {
      const dstDifference = (isdst === 0 ? 1 : 0) - (zone.isDst(t) ? 0 : 1)
      shifted = t + 3600 * dstDifference
    }
    t = shifted
  }

  state.offset = requested - t
  Object.assign(tm, localtime(t, zone))
  return t
}
