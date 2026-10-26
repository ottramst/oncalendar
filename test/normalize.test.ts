import { describe, expect, it } from 'vitest'
import { CalendarSpecError, normalize, parse } from '../src/index.ts'
import { referenceGolden, runResult } from './golden.ts'

const ERRNO: Readonly<Record<string, string>> = {
  'Invalid argument': 'EINVAL',
  'Numerical result out of range': 'ERANGE',
  'No buffer space available': 'ENOBUFS',
}

const golden = referenceGolden()

// Every distinct (input, zone) pair: the zone matters only for abbreviations like CET.
const cases = golden.cases.flatMap((c) => {
  const seen = new Set<string>()
  return c.runs.flatMap((r) => {
    if (seen.has(r.tz)) return []
    seen.add(r.tz)
    return [{ input: c.input, tz: r.tz, ...runResult(c, r) }]
  })
})

describe(`normalize matches systemd ${golden.systemd.version}`, () => {
  it.each(cases)('$input ($tz)', ({ input, tz, normalized, error }) => {
    if (normalized !== undefined) {
      expect(normalize(input, { timeZone: tz })).toBe(normalized)
      expect(normalize(normalized, { timeZone: tz }), 'idempotent').toBe(normalized)
    } else {
      let thrown: unknown
      try {
        parse(input, { timeZone: tz })
      } catch (e) {
        thrown = e
      }
      expect(thrown).toBeInstanceOf(CalendarSpecError)
      const code = error === undefined ? undefined : ERRNO[error]
      if (code !== undefined) expect((thrown as CalendarSpecError).code).toBe(code)
    }
  })
})
