import type { AutomationDueSlot, AutomationJob } from "../domain";
import { isoWeekKey } from "./time";

const dayNames = new Map([
  ["SUN", 0],
  ["MON", 1],
  ["TUE", 2],
  ["WED", 3],
  ["THU", 4],
  ["FRI", 5],
  ["SAT", 6],
]);

const monthNames = new Map([
  ["JAN", 1],
  ["FEB", 2],
  ["MAR", 3],
  ["APR", 4],
  ["MAY", 5],
  ["JUN", 6],
  ["JUL", 7],
  ["AUG", 8],
  ["SEP", 9],
  ["OCT", 10],
  ["NOV", 11],
  ["DEC", 12],
]);

export function dueSlotForJob(
  job: AutomationJob,
  now = new Date(),
  timezone = localTimezone(),
): AutomationDueSlot | undefined {
  if (!matchesCron(job.schedule, now, timezone)) return undefined;
  return {
    jobId: job.id,
    slotId: `${job.id}/${slotKey(job, now, timezone)}`,
    dueAt: now.toISOString(),
  };
}

export function dueSlotsForJobBetween(
  job: AutomationJob,
  startExclusive: Date,
  endInclusive: Date,
  timezone = localTimezone(),
): AutomationDueSlot[] {
  const slots = new Map<string, AutomationDueSlot>();
  for (
    let time = nextMinute(startExclusive).getTime();
    time <= endInclusive.getTime();
    time += 60_000
  ) {
    const slot = dueSlotForJob(job, new Date(time), timezone);
    if (slot) slots.set(slot.slotId, slot);
  }
  return [...slots.values()].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export function matchesCron(schedule: string, date: Date, timezone = "UTC"): boolean {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Unsupported cron schedule "${schedule}". Expected five fields.`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const parts = zonedDateParts(date, timezone);
  return (
    matchField(minute!, parts.minute, 0, 59) &&
    matchField(hour!, parts.hour, 0, 23) &&
    matchField(dayOfMonth!, parts.dayOfMonth, 1, 31) &&
    matchField(month!, parts.month, 1, 12, monthNames) &&
    matchField(dayOfWeek!, parts.dayOfWeek, 0, 6, dayNames)
  );
}

function nextMinute(date: Date): Date {
  const time = date.getTime();
  const rounded = Math.floor(time / 60_000) * 60_000;
  return new Date(rounded + 60_000);
}

function matchField(
  field: string,
  value: number,
  min: number,
  max: number,
  aliases = new Map<string, number>(),
): boolean {
  return field.split(",").some((part) => matchPart(part.toUpperCase(), value, min, max, aliases));
}

function matchPart(
  part: string,
  value: number,
  min: number,
  max: number,
  aliases: Map<string, number>,
): boolean {
  const [rangeText, stepText] = part.split("/");
  const step = stepText ? Number(stepText) : 1;
  if (!Number.isInteger(step) || step <= 0) {
    throw new Error(`Invalid cron step "${part}".`);
  }
  const [start, end] = parseRange(rangeText!, min, max, aliases);
  if (value < start || value > end) return false;
  return (value - start) % step === 0;
}

function parseRange(
  text: string,
  min: number,
  max: number,
  aliases: Map<string, number>,
): [number, number] {
  if (text === "*") return [min, max];
  const parts = text.split("-");
  if (parts.length === 1) {
    const value = parseCronValue(parts[0]!, aliases);
    return [normalizeDayOfWeek(value, max), normalizeDayOfWeek(value, max)];
  }
  if (parts.length === 2) {
    return [
      normalizeDayOfWeek(parseCronValue(parts[0]!, aliases), max),
      normalizeDayOfWeek(parseCronValue(parts[1]!, aliases), max),
    ];
  }
  throw new Error(`Invalid cron range "${text}".`);
}

function parseCronValue(value: string, aliases: Map<string, number>): number {
  return aliases.get(value) ?? Number(value);
}

function normalizeDayOfWeek(value: number, max: number): number {
  return max === 6 && value === 7 ? 0 : value;
}

function slotKey(job: AutomationJob, date: Date, timezone: string): string {
  if (isEveryNHours(job.schedule)) {
    return `${safeTimezoneKey(timezone)}/${zonedDateKey(date, timezone)}T${zonedTimeKey(date, timezone)}`;
  }
  const prefix = safeTimezoneKey(timezone);
  if (isWeekly(job.schedule)) {
    return `${prefix}/${isoWeekKey(zonedDate(date, timezone))}`;
  }
  if (isDailyOrWeekday(job.schedule)) {
    return `${prefix}/${zonedDateKey(date, timezone)}`;
  }
  return `${prefix}/${zonedDateKey(date, timezone)}T${zonedTimeKey(date, timezone)}`;
}

function isEveryNHours(schedule: string): boolean {
  const [, hour, day, month, weekday] = schedule.trim().split(/\s+/);
  return (
    day === "*" &&
    month === "*" &&
    weekday === "*" &&
    (hour === "*" || hour?.startsWith("*/") === true)
  );
}

function isDailyOrWeekday(schedule: string): boolean {
  const [, , day, month] = schedule.trim().split(/\s+/);
  return day === "*" && month === "*";
}

function isWeekly(schedule: string): boolean {
  const [, , day, month, weekday] = schedule.trim().split(/\s+/);
  return (
    day === "*" &&
    month === "*" &&
    weekday !== "*" &&
    !weekday?.includes("-") &&
    !weekday?.includes(",")
  );
}

type ZonedDateParts = {
  year: number;
  month: number;
  dayOfMonth: number;
  dayOfWeek: number;
  hour: number;
  minute: number;
};

function zonedDateParts(date: Date, timezone: string): ZonedDateParts {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    values.find((value) => value.type === type)?.value;
  const dayOfWeek = dayNames.get(part("weekday")?.toUpperCase() ?? "");
  if (dayOfWeek === undefined) {
    throw new Error(`Could not resolve weekday for timezone "${timezone}".`);
  }
  return {
    year: Number(part("year")),
    month: Number(part("month")),
    dayOfMonth: Number(part("day")),
    dayOfWeek,
    hour: Number(part("hour")),
    minute: Number(part("minute")),
  };
}

function zonedDate(date: Date, timezone: string): Date {
  const parts = zonedDateParts(date, timezone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.dayOfMonth));
}

function zonedDateKey(date: Date, timezone: string): string {
  const parts = zonedDateParts(date, timezone);
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.dayOfMonth).padStart(2, "0"),
  ].join("-");
}

function zonedTimeKey(date: Date, timezone: string): string {
  const parts = zonedDateParts(date, timezone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function safeTimezoneKey(timezone: string): string {
  return timezone.replaceAll("/", "-");
}

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
