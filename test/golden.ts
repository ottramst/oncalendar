/** Loads the golden vectors written by scripts/golden/generate.ts. */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface GoldenRun {
  readonly tz: string
  readonly base: number
  /** Present only when this run's parse result differs from the case's; null means absent. */
  readonly normalized?: string | null
  readonly error?: string | null
  readonly warning?: string | null
  /** Next elapses in UTC, truncated to whole seconds; absent when parsing failed. */
  readonly elapses?: readonly string[]
  /** systemd failed computing the elapse after `elapses`, e.g. "Resource deadlock avoided". */
  readonly elapseError?: string
}

export interface GoldenCase {
  readonly input: string
  readonly normalized?: string
  readonly error?: string
  readonly warning?: string
  readonly runs: readonly GoldenRun[]
}

export interface Golden {
  readonly systemd: { readonly version: number; readonly full: string }
  readonly image: string
  readonly glibc: string
  readonly tzdata: string
  readonly generated: string
  readonly cases: readonly GoldenCase[]
}

const dir = join(import.meta.dirname, 'golden')

export function goldenVersions(): number[] {
  return readdirSync(dir)
    .map((f) => /^systemd-(\d+)\.json$/.exec(f)?.[1])
    .filter((v) => v !== undefined)
    .map(Number)
    .sort((a, b) => a - b)
}

export function loadGolden(version: number): Golden {
  return JSON.parse(readFileSync(join(dir, `systemd-${version}.json`), 'utf8')) as Golden
}

/** The newest systemd in the matrix; the implementation targets its behaviour. */
export function referenceGolden(): Golden {
  const versions = goldenVersions()
  return loadGolden(versions[versions.length - 1] as number)
}

/** A run's parse result, falling back to its case's. */
export function runResult(
  c: GoldenCase,
  r: GoldenRun,
): {
  normalized?: string
  error?: string
  warning?: string
} {
  const own = r.normalized !== undefined || r.error !== undefined || r.warning !== undefined
  const source = own ? r : c
  return {
    ...(source.normalized != null && { normalized: source.normalized }),
    ...(source.error != null && { error: source.error }),
    ...(source.warning != null && { warning: source.warning }),
  }
}
