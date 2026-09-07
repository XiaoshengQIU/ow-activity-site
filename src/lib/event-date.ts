export const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
export const DAY_MS = 86_400_000;

export function shanghaiDateValue(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function parseShanghaiDate(
  value: string,
  endOfDay = false,
): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T00:00:00+08:00");
  if (Number.isNaN(date.getTime()) || shanghaiDateValue(date) !== value)
    return null;
  return endOfDay ? new Date(date.getTime() + DAY_MS - 1) : date;
}

export function shanghaiDayBounds(now: Date = new Date()) {
  const today = parseShanghaiDate(shanghaiDateValue(now))!;
  return { today, tomorrow: new Date(today.getTime() + DAY_MS) };
}

export type ScheduledEventStatus =
  "DRAFT" | "OPEN" | "CLOSED" | "RUNNING" | "FINISHED" | "CANCELLED";

export function scheduledEventStatus(
  event: {
    startTime: Date;
    signupDeadline?: Date | null;
    status: ScheduledEventStatus;
  },
  now = new Date(),
): ScheduledEventStatus {
  if (event.status === "DRAFT" || event.status === "CANCELLED")
    return event.status;
  const { today, tomorrow } = shanghaiDayBounds(now);
  if (event.startTime < today) return "FINISHED";
  if (event.startTime < tomorrow) return "RUNNING";
  if (
    event.status === "CLOSED" ||
    (event.signupDeadline && event.signupDeadline < now)
  )
    return "CLOSED";
  return "OPEN";
}

/** 日期加时刻，精确到分，不带星期。报名截止和活动时间都用它。 */
export function formatEventMoment(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatEventDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(date);
}
