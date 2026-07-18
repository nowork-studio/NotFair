/**
 * Heartbeat cadence presets for the goal loop. UTC cron under the hood
 * (matching the scheduler); labels speak human. 16:00 UTC ≈ 9am Pacific
 * (summer) — same convention the goal skill teaches.
 */
export type CadenceOption = { value: string; label: string; hint: string };

export const CADENCE_OPTIONS: CadenceOption[] = [
  { value: "0 * * * *", label: "Hourly", hint: "every hour" },
  { value: "0 16 * * *", label: "Daily", hint: "every day, 9am PT" },
  { value: "0 16 * * 1-5", label: "Weekdays", hint: "Mon–Fri, 9am PT" },
  { value: "0 */6 * * *", label: "4× daily", hint: "every 6 hours" },
  { value: "0 16 * * 1", label: "Weekly", hint: "Mondays, 9am PT" },
];

export const DEFAULT_CADENCE = CADENCE_OPTIONS[0]!.value;

export function cadenceLabel(cron: string): string {
  const preset = CADENCE_OPTIONS.find((o) => o.value === cron);
  return preset ? `${preset.label} (${preset.hint})` : cron;
}
