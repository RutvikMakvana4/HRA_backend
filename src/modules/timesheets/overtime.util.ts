/**
 * Overtime = any work logged on a Sunday (derived from the date, never stored). Working days are
 * Mon–Sat. Shared by the weekly summary (Task 5), the auto-submit cron (Task 6), and the leave
 * planner (Task 8) — one predicate, so "what counts as overtime" never drifts between call sites.
 */

/** Parse the date-only string as UTC (no local-TZ drift) and check whether it lands on a Sunday. */
export function isOvertimeDate(workDate: string): boolean {
  return new Date(workDate + 'T00:00:00Z').getUTCDay() === 0; // 0 = Sunday
}

/** Split a list of {workDate, minutes} into regular (Mon–Sat) vs overtime (Sun) minutes. */
export function splitMinutes(entries: { workDate: string; minutes: number }[]): {
  regular: number;
  overtime: number;
} {
  let regular = 0;
  let overtime = 0;
  for (const e of entries) {
    if (isOvertimeDate(e.workDate)) overtime += e.minutes;
    else regular += e.minutes;
  }
  return { regular, overtime };
}
