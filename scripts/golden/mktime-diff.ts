/**
 * Checks src/mktime.ts against glibc's mktime(), which next() depends on.
 *
 * Usage: pnpm golden:mktime
 *
 * Builds random sequences of mktime() calls near each DST transition in DST_ZONES (around the
 * requested wall-clock time, with tm_isdst -1, 0 and 1), runs them through a small C program in the
 * reference image and through the emulation, and reports any difference. Calls in a sequence share
 * glibc's cached offset, as they do within one systemd-analyze run.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mktime } from '../../src/mktime.ts'
import { getZone } from '../../src/zone.ts'
import { DST_ZONES, transitions } from './zones.ts'

const here = dirname(fileURLToPath(import.meta.url))
const { images } = JSON.parse(readFileSync(join(here, 'images.json'), 'utf8')) as {
  images: { name: string; digest: string }[]
}
const reference = images[images.length - 1] as { name: string; digest: string }

let seed = 1
const random = (n: number): number => {
  seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31
  return seed % n
}

const lines: string[] = []
for (const zone of DST_ZONES) {
  const days = transitions(zone).map((t) => {
    // The local date of the transition.
    const local = new Date((t + getZone(zone).offset(t)) * 1000)
    return [local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate()]
  })
  for (let s = 0; s < 40; s++) {
    const args: number[] = []
    for (let i = 0; i < 6; i++) {
      const [y, m, d] = days[random(days.length)] as number[]
      const hour = [22, 23, 24, 0, 1, 2, 3][random(7)] as number
      const min = [0, 15, 30, 45, 59, 60][random(6)] as number
      args.push(y as number, m as number, (d as number) - (hour >= 22 ? 1 : 0), hour % 24)
      args.push(min, random(2) * 30, random(3) - 1)
    }
    lines.push(`${zone} ${args.join(' ')}`)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'oncalendar-mktime-'))
try {
  writeFileSync(join(dir, 'in.txt'), `${lines.join('\n')}\n`)
  writeFileSync(join(dir, 'mktime.c'), readFileSync(join(here, 'mktime', 'mktime.c')))
  const script =
    'dnf -q -y install gcc tzdata >/dev/null 2>&1 && gcc -O0 -o /tmp/mk /work/mktime.c && ' +
    'while read zone args; do TZ=$zone /tmp/mk $args; done < /work/in.txt'
  const run = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${dir}:/work:ro`,
      `${reference.name}@${reference.digest}`,
      'sh',
      '-c',
      script,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  if (run.status !== 0) throw new Error(`docker failed: ${run.stderr}`)
  const expected = run.stdout.trim().split('\n')

  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  let index = 0
  let mismatches = 0
  for (const line of lines) {
    const [zone, ...rest] = line.split(' ')
    const n = rest.map(Number)
    const state = { offset: 0 }
    for (let i = 0; i < n.length; i += 7) {
      const [year, mon, mday, hour, min, sec, isdst] = n.slice(i, i + 7) as number[]
      const tm = {
        year: year as number,
        mon: (mon as number) - 1,
        mday: mday as number,
        hour: hour as number,
        min: min as number,
        sec: sec as number,
        isdst: isdst as number,
        wday: 0,
      }
      const t = mktime(tm, getZone(zone as string), state)
      const ours = `${t} ${tm.year}-${pad(tm.mon + 1)}-${pad(tm.mday)} ${pad(tm.hour)}:${pad(tm.min)}:${pad(tm.sec)} isdst=${tm.isdst}`
      const theirs = expected[index++]
      if (ours !== theirs) {
        mismatches++
        console.error(
          `${zone} ${n.slice(i, i + 7).join(' ')}\n  glibc: ${theirs}\n  ours:  ${ours}`,
        )
      }
    }
  }
  console.error(`${index - mismatches}/${index} calls match glibc (${reference.name})`)
  process.exitCode = mismatches > 0 ? 1 : 0
} finally {
  rmSync(dir, { recursive: true, force: true })
}
