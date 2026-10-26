import { describe, it } from 'vitest'

// Golden vectors are generated from `systemd-analyze calendar` (see scripts/golden/), not copied from
// systemd's LGPL test suite.
describe('parse and normalize', () => {
  it.todo('matches the systemd-analyze normalized form for every golden vector')
  it.todo('normalizing twice is idempotent')
  it.todo('rejects inputs systemd rejects (EINVAL/ERANGE)')
})

describe('next', () => {
  it.todo('matches systemd-analyze --iterations from a fixed --base-time')
  it.todo('skips nonexistent local times on spring-forward (Pacific/Auckland)')
  it.todo('fires a fixed time once on fall-back')
  it.todo('returns no elapse for impossible dates (*-04-31)')
  it.todo('handles negative DST zones (Europe/Dublin)')
})

describe('describe', () => {
  it.todo('describes shorthands, weekday ranges, ~ end-of-month and timezones')
})
