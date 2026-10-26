import { describe, expect, it } from 'vitest'
import { next } from '../src/index.ts'
import { referenceGolden, runResult } from './golden.ts'

const golden = referenceGolden()

const runs = golden.cases.flatMap((c) =>
  c.runs
    .filter((r) => runResult(c, r).normalized !== undefined)
    .map((r) => ({
      input: c.input,
      tz: r.tz,
      base: r.base,
      at: new Date(r.base * 1000).toISOString(),
      elapses: r.elapses ?? [],
    })),
)

/** systemd-analyze prints whole seconds. */
const seconds = (d: Date): string => `${d.toISOString().slice(0, 19)}Z`

describe(`next matches systemd ${golden.systemd.version}`, () => {
  it.each(runs)('$input ($tz, after $at)', ({ input, tz, base, elapses }) => {
    const result = next(input, { after: new Date(base * 1000), timeZone: tz, count: 10 })
    expect(result.map(seconds)).toEqual(elapses)
  })
})
