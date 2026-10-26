/** Zones and DST transitions shared by the golden generator and the mktime() check. */

// One-hour changes at night, negative DST (Dublin), changes at midnight (Beirut, Havana) and a
// 30-minute change (Lord Howe).
export const DST_ZONES: readonly string[] = [
  'Europe/Berlin',
  'Pacific/Auckland',
  'Europe/Dublin',
  'America/New_York',
  'Asia/Beirut',
  'America/Havana',
  'Australia/Lord_Howe',
]

function offsetMinutes(zone: string, ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'longOffset',
  }).formatToParts(ms)
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
  const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name)
  if (!m) throw new Error(`unexpected offset ${name}`)
  if (!m[1]) return 0
  const minutes = Number(m[2]) * 60 + Number(m[3])
  return m[1] === '-' ? -minutes : minutes
}

/** DST transitions (unix seconds) in 2026 and 2027, found by scanning hourly and bisecting. */
export function transitions(zone: string): number[] {
  const found: number[] = []
  const end = Date.UTC(2028, 0, 1)
  for (let t = Date.UTC(2026, 0, 1); t < end; t += 3_600_000) {
    if (offsetMinutes(zone, t) === offsetMinutes(zone, t + 3_600_000)) continue
    let lo = t
    let hi = t + 3_600_000
    const before = offsetMinutes(zone, lo)
    while (hi - lo > 1000) {
      const mid = lo + Math.floor((hi - lo) / 2000) * 1000
      if (offsetMinutes(zone, mid) === before) lo = mid
      else hi = mid
    }
    found.push(hi / 1000)
  }
  return found
}
