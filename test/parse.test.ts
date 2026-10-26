import { describe, expect, it } from 'vitest'
import { CalendarSpecError, normalize, parse } from '../src/index.ts'

describe('parse', () => {
  it('builds the spec model', () => {
    expect(parse('Mon..Fri *-*~03/2 9..17/2:30:1.5 Europe/Tallinn')).toEqual({
      weekdays: 0b0011111,
      year: null,
      month: null,
      day: [{ start: 3, stop: null, repeat: 2 }],
      endOfMonth: true,
      hour: [{ start: 9, stop: 17, repeat: 2 }],
      minute: [{ start: 30, stop: null, repeat: 0 }],
      microsecond: [{ start: 1_500_000, stop: null, repeat: 0 }],
      timeZone: 'Europe/Tallinn',
      dst: null,
    })
  })

  it('represents * seconds as null', () => {
    expect(parse('*:*:*').microsecond).toBeNull()
    expect(parse('*:*:0/1').microsecond).toBeNull()
  })

  it('treats the evaluating zone abbreviations like systemd treats the host TZ', () => {
    expect(parse('*-*-* 12:00 CET', { timeZone: 'Europe/Berlin' })).toMatchObject({
      timeZone: 'CET',
      dst: false,
    })
    expect(parse('*-*-* 12:00 cest', { timeZone: 'Europe/Berlin' })).toMatchObject({
      timeZone: 'CEST',
      dst: true,
    })
    // Without that zone, CET is the tzdata zone of that name.
    expect(parse('*-*-* 12:00 CET', { timeZone: 'UTC' })).toMatchObject({
      timeZone: 'CET',
      dst: null,
    })
    expect(() => parse('*-*-* 12:00 CEST', { timeZone: 'UTC' })).toThrow(CalendarSpecError)
  })

  it('reports the errno systemd would', () => {
    expect(() => parse('*:0/0')).toThrow(expect.objectContaining({ code: 'ERANGE' }))
    expect(() => parse('garbage')).toThrow(expect.objectContaining({ code: 'EINVAL' }))
  })

  it('normalizes a parsed spec', () => {
    expect(normalize(parse('weekly UTC'))).toBe('Mon *-*-* 00:00:00 UTC')
  })
})
