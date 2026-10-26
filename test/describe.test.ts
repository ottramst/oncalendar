import { expect, describe as group, it } from 'vitest'
import { describe } from '../src/index.ts'
import { referenceGolden } from './golden.ts'

// systemd has no descriptions, so these pin our own wording.
const EXPECTED: readonly (readonly [string, string])[] = [
  ['minutely', 'Every minute'],
  ['hourly', 'Every hour'],
  ['daily', 'At 00:00 every day'],
  ['weekly', 'At 00:00 on Monday'],
  ['monthly', 'At 00:00 on the 1st of every month'],
  ['quarterly', 'At 00:00 on the 1st of January, April, July and October'],
  ['semiannually', 'At 00:00 on the 1st of January and July'],
  ['yearly', 'At 00:00 on January 1'],
  ['Mon..Fri 09:00 Europe/Tallinn', 'At 09:00 on Monday through Friday (Europe/Tallinn)'],
  ['Sat,Sun 10:00', 'At 10:00 on Saturday and Sunday'],
  ['Thu,Sat..Sun 22:45', 'At 22:45 on Thursday, Saturday and Sunday'],
  ['*-*-* 8,12,18:30', 'At 08:30, 12:30 and 18:30 every day'],
  ['*-*-* 9..17:00', 'Every hour from 09:00 through 17:00'],
  ['*-*-* 9..17/2:00', 'Every 2 hours from 09:00 through 17:00'],
  ['*-*-* 8..16/2:15', 'Every 2 hours from 08:15 through 16:15'],
  ['*:0/15', 'Every 15 minutes'],
  ['*:5/10', 'Every 10 minutes starting at minute 5'],
  ['*:20..35/5', 'Every 5 minutes from minute 20 through 35'],
  ['*:*:0/30', 'Every 30 seconds'],
  ['*:*:*', 'Every second'],
  ['*:30', 'Every hour at :30'],
  ['*:15,45', 'Every hour at :15 and :45'],
  ['*-*-* 0/2:00', 'Every 2 hours starting at 00:00'],
  ['*-*-1/2', 'At 00:00 on every 2nd day of every month'],
  ['*-*-01,15 12:00', 'At 12:00 on the 1st and 15th of every month'],
  ['*-12-25 08:00', 'At 08:00 on December 25'],
  ['2026-11-05 13:45', 'At 13:45 on 2026-11-05'],
  ['*-*~01 23:00', 'At 23:00 on the last day of every month'],
  ['*-02~03', 'At 00:00 on the 3rd-to-last day of February'],
  ['*-*~1..3', 'At 00:00 on the last 3 days of every month'],
  ['Mon *-05~07/1', 'At 00:00 on the last Monday of May'],
  ['Fri *-*~7/1 18:00', 'At 18:00 on the last Friday of every month'],
  ['Fri *-*-13', 'At 00:00 on the 13th of every month if it is a Friday'],
  ['*-06..08-* 12:00', 'At 12:00 every day in June through August'],
  ['2026..2028-01-01', 'At 00:00 on January 1 in 2026 through 2028'],
  ['2026/2-01-01', 'At 00:00 on January 1 every 2 years starting in 2026'],
  ['*:*:1.5', 'Every minute at second 1.5'],
  ['12:00:30.5 UTC', 'At 12:00:30.5 every day (UTC)'],
  ['@1790000000', 'At 14:13:20 on 2026-09-21 (UTC)'],
  ['*-01/3-01', 'At 00:00 on the 1st, every 3 months'],
  [
    'Mon..Fri *-*-* 9..17:0/30',
    'Every 30 minutes from 09:00 through 17:59 on Monday through Friday',
  ],
  [
    '*:5..10/3,40..50/7',
    'Every 3 minutes from minute 5 through 8 and every 7 minutes from minute 40 through 47',
  ],
  ['*:*:0/0.5', 'Every 0.5 seconds'],
  ['*-*-1..7 06:00', 'At 06:00 on the 1st through 7th of every month'],
]

group('describe', () => {
  it.each(EXPECTED)('%s', (input, text) => {
    expect(describe(input, { timeZone: 'UTC' })).toBe(text)
  })

  it('describes abbreviations of the evaluating zone', () => {
    expect(describe('*-*-* 12:00 CEST', { timeZone: 'Europe/Berlin' })).toBe(
      'At 12:00 every day (CEST)',
    )
  })

  it('produces clean text for every expression systemd accepts', () => {
    for (const c of referenceGolden().cases) {
      if (c.normalized === undefined) continue
      const text = describe(c.input, { timeZone: 'UTC' })
      expect(text, c.input).toMatch(/^[A-Z]/)
      expect(text, c.input).not.toMatch(/undefined|NaN|null| {2}|,,|^\W/)
    }
  })
})
