/**
 * Generates test/golden/*.json by running `systemd-analyze calendar` in containers.
 *
 * Usage: pnpm golden [image-name ...]
 *
 * Needs Docker. Each image in images.json is pulled by digest, systemd is installed if missing, and
 * run-in-container.sh evaluates every case (expression x time zone x base time) in one container run.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', '..', 'test', 'golden')

interface Image {
  readonly name: string
  readonly digest: string
  readonly install: string
}

interface Expression {
  readonly input: string
  readonly dst: boolean
}

interface Outcome {
  normalized?: string
  error?: string
  warning?: string
  elapses?: string[]
}

interface Run {
  readonly tz: string
  readonly base: number
  // Present only when this run's parse result differs from the case's; null means absent.
  normalized?: string | null
  error?: string | null
  warning?: string | null
  elapses?: string[]
}

interface Case extends Outcome {
  readonly input: string
  readonly runs: Run[]
}

interface Golden {
  readonly systemd: { readonly version: number; readonly full: string }
  readonly image: string
  readonly glibc: string
  readonly tzdata: string
  readonly generated: string
  readonly cases: Case[]
}

const DST_ZONES = ['Europe/Berlin', 'Pacific/Auckland', 'Europe/Dublin', 'America/New_York']
// 2026-06-15T10:30:00Z, a plain instant away from any transition.
const PLAIN = Date.UTC(2026, 5, 15, 10, 30) / 1000
// 2026-12-31T23:59:30Z, just before a year change.
const YEAR_END = Date.UTC(2026, 11, 31, 23, 59, 30) / 1000
// Offsets from each DST transition: an hour before, a minute before, and inside the repeated hour.
const TRANSITION_OFFSETS = [-3600, -60, 1800]

function readExpressions(): Expression[] {
  const lines = readFileSync(join(here, 'expressions.txt'), 'utf8').split('\n')
  const expressions: Expression[] = []
  let dst = false
  for (const line of lines) {
    if (line.startsWith('## ')) {
      dst = line.startsWith('## [dst]')
      continue
    }
    if (line === '' || line.startsWith('#')) continue
    const input = line.startsWith('"') ? (JSON.parse(line) as string) : line
    if (input.includes('\n')) throw new Error(`expression contains a newline: ${line}`)
    expressions.push({ input, dst })
  }
  // Long lists probe the component limit; they're too long to keep readable in expressions.txt.
  const hours = (n: number) => Array.from({ length: n }, (_, i) => i % 24).join(',')
  for (const n of [240, 241, 242, 1000])
    expressions.push({ input: `*-*-* ${hours(n)}:00`, dst: false })
  const seen = new Set<string>()
  for (const { input } of expressions) {
    if (seen.has(input)) throw new Error(`duplicate expression: ${JSON.stringify(input)}`)
    seen.add(input)
  }
  return expressions
}

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
function transitions(zone: string): number[] {
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

function buildCases(expressions: Expression[]): [string, number, string][] {
  const common: [string, number][] = [
    ['UTC', PLAIN],
    ['UTC', YEAR_END],
    ['Europe/Berlin', PLAIN],
    ['Pacific/Auckland', PLAIN],
  ]
  const dst: [string, number][] = DST_ZONES.flatMap((zone) =>
    transitions(zone).flatMap((t) =>
      TRANSITION_OFFSETS.map((o): [string, number] => [zone, t + o]),
    ),
  )
  return expressions.flatMap(({ input, dst: isDst }) =>
    [...common, ...(isDst ? dst : [])].map(([tz, base]): [string, number, string] => [
      tz,
      base,
      input,
    ]),
  )
}

function exec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (b: Buffer) => out.push(b))
    child.stderr.on('data', (b: Buffer) => err.push(b))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'))
      else reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(err).toString('utf8')}`))
    })
  })
}

const UTC_STAMP = /^\w{3} (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/

function toIso(stamp: string): string {
  const m = UTC_STAMP.exec(stamp.trim())
  if (!m) throw new Error(`unexpected UTC timestamp: ${stamp}`)
  return `${m[1]}T${m[2]}Z`
}

/** Parses one case's stdout, stderr and exit code into an outcome. */
function parseOutcome(input: string, stdout: string[], stderr: string[], rc: number): Outcome {
  const outcome: Outcome = {}
  const messages = stderr.filter((l) => l !== '')
  if (rc !== 0) {
    // The log line is cut off for very long inputs, losing the errno text at the end.
    const line = messages.find((l) => l.startsWith('Failed to parse calendar specification '))
    if (line === undefined) {
      throw new Error(`unexpected failure for ${JSON.stringify(input)}: ${messages.join('|')}`)
    }
    outcome.error = line.endsWith(`'${input}'`)
      ? '(message truncated)'
      : (/': ([^:']+)$/.exec(line)?.[1] ?? '(message truncated)')
    return outcome
  }
  if (messages.length > 0) outcome.warning = messages.join('\n')
  const elapses: string[] = []
  let pending: string | null = null
  for (const line of stdout) {
    let m = /^\s*Normalized form: (.*)$/.exec(line)
    if (m) {
      outcome.normalized = m[1] as string
      continue
    }
    // v252 labels later iterations "Iter. #N", newer versions "Iteration #N".
    m = /^\s*(?:Next elapse|Iter(?:\.|ation) #\d+): (.*)$/.exec(line)
    if (m) {
      if (pending !== null) elapses.push(toIso(pending))
      pending = m[1] as string
      if (pending === 'never') pending = null
      continue
    }
    m = /^\s*\(in UTC\): (.*)$/.exec(line)
    if (m) {
      pending = m[1] as string
      continue
    }
    if (!/^\s*(?:Original form|From now): |^$/.test(line)) {
      throw new Error(`unexpected output for ${JSON.stringify(input)}: ${line}`)
    }
  }
  if (pending !== null) elapses.push(toIso(pending))
  if (outcome.normalized === undefined) throw new Error(`no normalized form for ${input}`)
  outcome.elapses = elapses
  return outcome
}

function sameOutcome(a: Outcome, b: Outcome): boolean {
  return a.normalized === b.normalized && a.error === b.error && a.warning === b.warning
}

async function generate(
  image: Image,
  casesDir: string,
  expressions: Expression[],
): Promise<Golden> {
  const ref = `${image.name}@${image.digest}`
  console.error(`${image.name}: running`)
  const started = Date.now()
  const script = `(command -v systemd-analyze >/dev/null || { ${image.install}; } >/dev/null 2>&1) && sh /golden/run-in-container.sh /golden/cases.tsv`
  const raw = await exec('docker', [
    'run',
    '--rm',
    '-v',
    `${casesDir}:/golden:ro`,
    ref,
    'sh',
    '-c',
    script,
  ])
  console.error(`${image.name}: done in ${Math.round((Date.now() - started) / 1000)} s`)

  const lines = raw.split('\n')
  const header = (key: string) =>
    (lines.find((l) => l.startsWith(`@@${key} `)) ?? '').slice(key.length + 3)
  const full = header('SYSTEMD')
  const version = Number(/^systemd (\d+)/.exec(full)?.[1])
  if (!version) throw new Error(`${image.name}: no systemd version in output`)

  const byInput = new Map<string, Case>()
  for (const { input } of expressions) byInput.set(input, { input, runs: [] })

  let i = 0
  while (i < lines.length) {
    const line = lines[i] as string
    i++
    if (!line.startsWith('@@CASE\t')) continue
    const [, tz, base, ...rest] = line.split('\t')
    const input = rest.join('\t')
    const stdout: string[] = []
    while (lines[i] !== '@@STDERR') stdout.push(lines[i++] as string)
    i++
    const stderr: string[] = []
    while (!(lines[i] as string).startsWith('@@RC ')) stderr.push(lines[i++] as string)
    const rc = Number((lines[i++] as string).slice(5))
    const c = byInput.get(input)
    if (!c || tz === undefined) throw new Error(`unknown case in output: ${line}`)
    const outcome = parseOutcome(input, stdout, stderr, rc)
    if (c.runs.length === 0) {
      if (outcome.normalized !== undefined) c.normalized = outcome.normalized
      if (outcome.error !== undefined) c.error = outcome.error
      if (outcome.warning !== undefined) c.warning = outcome.warning
    }
    const run: Run = { tz, base: Number(base) }
    // Only record parse results per run when they differ from the case (e.g. zone abbreviations).
    if (!sameOutcome(c, outcome)) {
      run.normalized = outcome.normalized ?? null
      run.error = outcome.error ?? null
      run.warning = outcome.warning ?? null
    }
    if (outcome.elapses) run.elapses = outcome.elapses
    c.runs.push(run)
  }
  const cases = [...byInput.values()]
  const total = cases.reduce((n, c) => n + c.runs.length, 0)
  console.error(`${image.name}: systemd ${version}, ${cases.length} expressions, ${total} runs`)
  return {
    systemd: { version, full },
    image: ref,
    glibc: header('GLIBC'),
    tzdata: header('TZDATA'),
    generated: new Date().toISOString().slice(0, 10),
    cases,
  }
}

/** JSON with one run per line, so diffs between regenerations stay readable. */
function format(golden: Golden): string {
  const { cases, ...meta } = golden
  const body = cases.map((c) => {
    const { runs, ...rest } = c
    const head = JSON.stringify(rest).slice(0, -1)
    const lines = runs.map((r) => `      ${JSON.stringify(r)}`).join(',\n')
    return `    ${head},\n      "runs": [\n${lines}\n    ]}`
  })
  const metaJson = JSON.stringify(meta, null, 2).slice(0, -2)
  return `${metaJson},\n  "cases": [\n${body.join(',\n')}\n  ]\n}\n`
}

/** A run's full outcome, falling back to the case's parse result. */
function runOutcome(c: Case, r: Run): Outcome {
  const own = r.normalized !== undefined || r.error !== undefined || r.warning !== undefined
  const source = own ? r : c
  const outcome: Outcome = {}
  if (source.normalized != null) outcome.normalized = source.normalized
  if (source.error != null) outcome.error = source.error
  if (source.warning != null) outcome.warning = source.warning
  if (r.elapses) outcome.elapses = r.elapses
  return outcome
}

interface Difference {
  readonly input: string
  readonly tz: string
  readonly base: number
  readonly versions: Record<string, Outcome>
}

/** Every run whose outcome differs between versions, keyed by systemd version. */
function differences(goldens: Golden[]): Difference[] {
  const result: Difference[] = []
  const [first] = goldens
  if (!first || goldens.length < 2) return result
  first.cases.forEach((c, ci) => {
    c.runs.forEach((r, ri) => {
      const versions: Record<string, Outcome> = {}
      const keys = new Set<string>()
      for (const g of goldens) {
        const gc = g.cases[ci] as Case
        const gr = gc.runs[ri] as Run
        const outcome = runOutcome(gc, gr)
        versions[String(g.systemd.version)] = outcome
        keys.add(JSON.stringify(outcome))
      }
      if (keys.size > 1) result.push({ input: c.input, tz: r.tz, base: r.base, versions })
    })
  })
  return result
}

async function main(): Promise<void> {
  const { images } = JSON.parse(readFileSync(join(here, 'images.json'), 'utf8')) as {
    images: Image[]
  }
  const only = process.argv.slice(2)
  const selected = only.length > 0 ? images.filter((i) => only.includes(i.name)) : images
  const expressions = readExpressions()
  const cases = buildCases(expressions)
  const dir = mkdtempSync(join(tmpdir(), 'oncalendar-golden-'))
  try {
    writeFileSync(join(dir, 'cases.tsv'), cases.map((c) => `${c.join('\t')}\n`).join(''))
    writeFileSync(join(dir, 'run-in-container.sh'), readFileSync(join(here, 'run-in-container.sh')))
    console.error(`${expressions.length} expressions, ${cases.length} cases per image`)
    const goldens = await Promise.all(selected.map((image) => generate(image, dir, expressions)))
    for (const g of goldens) {
      writeFileSync(join(outDir, `systemd-${g.systemd.version}.json`), format(g))
    }
    if (selected.length === images.length) {
      const diffs = differences(goldens)
      writeFileSync(
        join(outDir, 'differences.json'),
        `[\n${diffs.map((d) => `  ${JSON.stringify(d)}`).join(',\n')}\n]\n`,
      )
      console.error(`${diffs.length} runs differ between versions`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

await main()
