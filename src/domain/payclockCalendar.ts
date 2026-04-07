export const KOREA_LOCALE = 'ko-KR'
export const KOREA_TIME_ZONE = 'Asia/Seoul'

export interface DayParts {
  year: number
  month: number
  day: number
}

const koreaNowFormatter = new Intl.DateTimeFormat(KOREA_LOCALE, {
  timeZone: KOREA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export function parseDayKey(dayKey: string): DayParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)
  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null
  }

  return { year, month, day }
}

export function formatDayKey(parts: DayParts): string {
  return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`
}

export function startOfMonth(dayKey: string): string {
  const parts = requireDayParts(dayKey)
  return formatDayKey({ year: parts.year, month: parts.month, day: 1 })
}

export function startOfNextMonth(dayKey: string): string {
  const parts = requireDayParts(startOfMonth(dayKey))
  if (parts.month === 12) {
    return formatDayKey({ year: parts.year + 1, month: 1, day: 1 })
  }

  return formatDayKey({ year: parts.year, month: parts.month + 1, day: 1 })
}

export function datesInMonth(containingDayKey: string): string[] {
  const monthStart = startOfMonth(containingDayKey)
  const parts = requireDayParts(monthStart)
  const length = daysInMonth(parts.year, parts.month)
  const dates: string[] = []

  for (let day = 1; day <= length; day += 1) {
    dates.push(formatDayKey({ year: parts.year, month: parts.month, day }))
  }

  return dates
}

export function isWeekday(dayKey: string): boolean {
  const weekday = weekdayIndex(dayKey)
  return weekday >= 1 && weekday <= 5
}

export function firstWeekdayOffset(dayKey: string): number {
  return weekdayIndex(startOfMonth(dayKey))
}

export function weekdayIndex(dayKey: string): number {
  const parts = requireDayParts(dayKey)
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
}

export function combineDayAndMinutes(dayKey: string, minutesFromMidnight: number, nextDay = false): number {
  const parts = requireDayParts(dayKey)
  const clampedMinutes = Math.max(0, Math.min(1_439, Math.trunc(minutesFromMidnight)))
  const hour = Math.floor(clampedMinutes / 60)
  const minute = clampedMinutes % 60
  const baseTimestamp = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0, 0)

  if (nextDay) {
    return baseTimestamp + 24 * 60 * 60 * 1_000
  }

  return baseTimestamp
}

export function dayByAdding(days: number, dayKey: string): string {
  return dayKeyFromTimestamp(timestampFromDayKey(dayKey) + days * 24 * 60 * 60 * 1_000)
}

export function monthByAdding(months: number, dayKey: string): string {
  const parts = requireDayParts(startOfMonth(dayKey))
  const next = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1, 0, 0, 0, 0))
  return formatDayKey({
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: 1,
  })
}

export function monthContains(monthDayKey: string, dayKey: string): boolean {
  return startOfMonth(monthDayKey) === startOfMonth(dayKey)
}

export function timestampFromDayKey(dayKey: string): number {
  const parts = requireDayParts(dayKey)
  return Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0)
}

export function dayKeyFromTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return formatDayKey({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  })
}

export function minutesFromMidnightForTimestamp(timestamp: number): number {
  const date = new Date(timestamp)
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

export function dayOffsetBetween(baseDayKey: string, targetDayKey: string): number {
  return Math.round((timestampFromDayKey(targetDayKey) - timestampFromDayKey(baseDayKey)) / (24 * 60 * 60 * 1_000))
}

export function currentKoreanTimestamp(currentDate = new Date()): number {
  const parts = koreaNowFormatter.formatToParts(currentDate)
  const values = new Map<string, number>()

  for (const part of parts) {
    if (part.type === 'literal') {
      continue
    }

    values.set(part.type, Number(part.value))
  }

  return Date.UTC(
    values.get('year') ?? 0,
    (values.get('month') ?? 1) - 1,
    values.get('day') ?? 1,
    values.get('hour') ?? 0,
    values.get('minute') ?? 0,
    values.get('second') ?? 0,
    0,
  )
}

export function dayKeyForCurrentKoreanTime(currentDate = new Date()): string {
  return dayKeyFromTimestamp(currentKoreanTimestamp(currentDate))
}

function requireDayParts(dayKey: string): DayParts {
  const parts = parseDayKey(dayKey)
  if (!parts) {
    throw new Error(`유효하지 않은 날짜 키입니다: ${dayKey}`)
  }

  return parts
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
