import { type CalendarSpec, CalendarSpecError, type NextOptions } from './spec.ts'

/** Returns the next elapse times; fewer than `count` (possibly none) if the spec stops elapsing. */
export function next(_spec: CalendarSpec | string, _options?: NextOptions): Date[] {
  throw new CalendarSpecError('next: not implemented')
}
