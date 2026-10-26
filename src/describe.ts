import { type CalendarSpec, CalendarSpecError } from './spec.ts'

/** Describes the expression in plain English, e.g. "Every weekday at 09:00 in Europe/Tallinn". */
export function describe(_spec: CalendarSpec | string): string {
  throw new CalendarSpecError('describe: not implemented')
}
