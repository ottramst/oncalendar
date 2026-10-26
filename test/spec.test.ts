import { describe, expect, it } from 'vitest'
import { next } from '../src/index.ts'

const iso = (dates: Date[]): string[] => dates.map((d) => d.toISOString())

describe('next', () => {
  it('skips nonexistent local times on spring-forward', () => {
    // Auckland moves from 02:00 NZST to 03:00 NZDT on 2026-09-27.
    const after = new Date('2026-09-26T12:00:00Z')
    expect(iso(next('*-*-* 02:30', { after, timeZone: 'Pacific/Auckland', count: 2 }))).toEqual([
      '2026-09-27T13:30:00.000Z',
      '2026-09-28T13:30:00.000Z',
    ])
  })

  it('fires a fixed time once on fall-back', () => {
    // New York repeats 01:00-02:00 on 2026-11-01; 01:30 fires at its first (EDT) occurrence only.
    const after = new Date('2026-11-01T04:00:00Z')
    expect(iso(next('*-*-* 01:30', { after, timeZone: 'America/New_York', count: 2 }))).toEqual([
      '2026-11-01T05:30:00.000Z',
      '2026-11-02T06:30:00.000Z',
    ])
  })

  it('skips the second pass through a repeated hour, like systemd (#8647)', () => {
    const after = new Date('2026-11-01T05:59:00Z')
    expect(iso(next('minutely', { after, timeZone: 'America/New_York' }))).toEqual([
      '2026-11-01T07:00:00.000Z',
    ])
  })

  it('handles negative DST zones (Europe/Dublin)', () => {
    const after = new Date('2026-03-29T00:30:00Z')
    expect(iso(next('hourly', { after, timeZone: 'Europe/Dublin', count: 2 }))).toEqual([
      '2026-03-29T01:00:00.000Z',
      '2026-03-29T02:00:00.000Z',
    ])
  })

  it('returns no elapse for impossible dates', () => {
    expect(next('*-04-31', { timeZone: 'UTC' })).toEqual([])
  })

  it('uses the zone in the expression over the timeZone option', () => {
    const after = new Date('2026-06-15T00:00:00Z')
    expect(iso(next('*-*-* 12:00 Europe/Berlin', { after, timeZone: 'America/New_York' }))).toEqual(
      ['2026-06-15T10:00:00.000Z'],
    )
  })

  it('truncates sub-millisecond elapses; continuing needs count or after + 1 ms', () => {
    const after = new Date('2026-06-15T10:30:00Z')
    const [first, second] = next('*:*:1.420001', { after, timeZone: 'UTC', count: 2 })
    expect(first?.toISOString()).toBe('2026-06-15T10:30:01.420Z')
    expect(second?.toISOString()).toBe('2026-06-15T10:31:01.420Z')
    const [again] = next('*:*:1.420001', { after: first as Date, timeZone: 'UTC' })
    expect(again).toEqual(first)
    const later = new Date((first as Date).getTime() + 1)
    expect(next('*:*:1.420001', { after: later, timeZone: 'UTC' })).toEqual([second])
  })

  it('continues from the last returned date for whole-millisecond elapses', () => {
    const after = new Date('2026-06-15T10:30:00Z')
    const [first] = next('*:*:0/0.25', { after, timeZone: 'UTC' })
    expect(next('*:*:0/0.25', { after: first as Date, timeZone: 'UTC' })[0]?.toISOString()).toBe(
      '2026-06-15T10:30:00.500Z',
    )
  })

  it('defaults to one elapse after now', () => {
    const [elapse] = next('minutely', { timeZone: 'UTC' })
    expect(elapse?.getTime()).toBeGreaterThan(Date.now())
  })
})

describe('describe', () => {
  it.todo('describes shorthands, weekday ranges, ~ end-of-month and timezones')
})
