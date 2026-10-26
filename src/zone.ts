/**
 * Time zone helpers built on `Intl.DateTimeFormat`. Temporal would be simpler, but Safari lacks it.
 */

let runtimeZone: string | undefined

/** The runtime's IANA zone, like systemd's use of the host `TZ`. */
export function defaultTimeZone(): string {
  runtimeZone ??= new Intl.DateTimeFormat().resolvedOptions().timeZone
  return runtimeZone
}

/**
 * ICU's legacy three-letter IDs that tzdata never had, so systemd rejects them. (`EST`, `MST`, `HST` and
 * friends are real tzdata zones and stay valid.)
 */
const ICU_ONLY = new Set([
  'ACT',
  'AET',
  'AGT',
  'ART',
  'AST',
  'BET',
  'BST',
  'CAT',
  'CNT',
  'CST',
  'CTT',
  'EAT',
  'ECT',
  'IET',
  'IST',
  'JST',
  'MIT',
  'NET',
  'NST',
  'PLT',
  'PNT',
  'PRT',
  'PST',
  'SST',
  'VST',
])

const NAME = /^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*$/

/**
 * Whether `name` is an IANA zone, like systemd's `timezone_is_valid()` checking for a tzdata file.
 * Zone files are case-sensitive, Intl is not: when Intl returns the name in another case, reject it;
 * when it canonicalizes an alias (`US/Eastern`), require each path segment to start with a capital.
 */
export function isValidTimeZone(name: string): boolean {
  if (!NAME.test(name) || /^[+-]/.test(name) || ICU_ONLY.has(name)) return false
  if (name.startsWith('SystemV/')) return false
  let resolved: string
  try {
    resolved = new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone
  } catch {
    return false
  }
  if (resolved === name) return true
  if (resolved.toLowerCase() === name.toLowerCase()) return false
  // `GMT` and `UTC` aliases canonicalize to `UTC`; other aliases need plausible capitalization.
  return name.split('/').every((segment) => /^[A-Z]/.test(segment))
}

const LOCALES = ['en-US', 'en-GB', 'en-IE', 'en-NZ', 'en-AU', 'en-IN', 'en-CA', 'en-ZA', 'en-SG']

function offsetName(
  locale: string,
  zone: string,
  at: number,
  style: 'short' | 'longOffset',
): string {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    timeZoneName: style,
  }).formatToParts(at)
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
}

const abbreviations = new Map<string, readonly [string, string] | null>()

/**
 * The zone's standard and daylight abbreviations, standing in for glibc's `tzname[0]` and `tzname[1]`.
 * Intl only has abbreviations in some locales, so this tries English locales until one has names that
 * are not plain GMT offsets. Returns `null` if none does. Zones without DST return the same name twice.
 */
export function zoneAbbreviations(zone: string): readonly [string, string] | null {
  const cached = abbreviations.get(zone)
  if (cached !== undefined) return cached
  const year = new Date().getUTCFullYear()
  const jan = Date.UTC(year, 0, 1)
  const jul = Date.UTC(year, 6, 1)
  const janOffset = offsetName('en-US', zone, jan, 'longOffset')
  const julOffset = offsetName('en-US', zone, jul, 'longOffset')
  let result: readonly [string, string] | null = null
  for (const locale of LOCALES) {
    const janName = offsetName(locale, zone, jan, 'short')
    const julName = offsetName(locale, zone, jul, 'short')
    if (/^(?:GMT|UTC)[+-]/.test(janName) || /^(?:GMT|UTC)[+-]/.test(julName)) continue
    if (janOffset === julOffset) result = [janName, janName]
    else
      result =
        offsetMinutes(janOffset) < offsetMinutes(julOffset)
          ? [janName, julName]
          : [julName, janName]
    break
  }
  abbreviations.set(zone, result)
  return result
}

/** Parses Intl's `longOffset` name (`GMT`, `GMT+05:30`) into minutes east of UTC. */
export function offsetMinutes(name: string): number {
  const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name)
  if (!m) throw new RangeError(`unexpected offset name: ${name}`)
  if (!m[1]) return 0
  const minutes = Number(m[2]) * 60 + Number(m[3])
  return m[1] === '-' ? -minutes : minutes
}
