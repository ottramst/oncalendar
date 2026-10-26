import { describe, expect, it } from 'vitest'
import { goldenVersions, loadGolden, runResult } from './golden.ts'

describe.each(goldenVersions())('golden vectors for systemd %i', (version) => {
  const golden = loadGolden(version)

  it('records where they came from', () => {
    expect(golden.systemd.version).toBe(version)
    expect(golden.image).toMatch(/@sha256:[0-9a-f]{64}$/)
    expect(golden.tzdata).not.toBe('')
  })

  it('has exactly one parse result per run and ordered elapses', () => {
    for (const c of golden.cases) {
      expect(c.runs.length).toBeGreaterThan(0)
      for (const r of c.runs) {
        const result = runResult(c, r)
        expect('normalized' in result !== 'error' in result, c.input).toBe(true)
        expect(r.elapses === undefined, c.input).toBe('error' in result)
        const elapses = r.elapses ?? []
        expect(elapses.length).toBeLessThanOrEqual(10)
        expect([...elapses].sort(), c.input).toEqual(elapses)
      }
    }
  })
})
