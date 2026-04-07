import { KOREA_LOCALE } from '../domain/payclockCalendar'
import {
  dayKeyFromTimestamp,
  dayOffsetBetween,
  minutesFromMidnightForTimestamp,
  parseDayKey,
  timestampFromDayKey,
} from '../domain/payclockCalendar'

const monthFormatter = new Intl.DateTimeFormat(KOREA_LOCALE, {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'long',
})

const dayFormatter = new Intl.DateTimeFormat(KOREA_LOCALE, {
  timeZone: 'UTC',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
})

const currencyFormatter = new Intl.NumberFormat(KOREA_LOCALE, {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
})

export function monthLabel(dayKey: string): string {
  return monthFormatter.format(new Date(timestampFromDayKey(dayKey) + 12 * 60 * 60 * 1_000))
}

export function dayLabel(dayKey: string): string {
  return dayFormatter.format(new Date(timestampFromDayKey(dayKey) + 12 * 60 * 60 * 1_000))
}

export function currency(amount: number): string {
  return currencyFormatter.format(Math.round(amount))
}

export function hours(hoursValue: number): string {
  return `${hoursValue.toFixed(1)}시간`
}

export function wholeHours(hoursValue: number): string {
  return `${Math.floor(hoursValue)}시간`
}

export function hoursFromSeconds(seconds: number): string {
  return hours(seconds / 3_600)
}

export function clockText(minutes: number | null): string {
  if (minutes === null) {
    return ''
  }

  return `${`${Math.floor(minutes / 60)}`.padStart(2, '0')}:${`${minutes % 60}`.padStart(2, '0')}`
}

export function durationText(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.trunc(totalMinutes))
  const hour = Math.floor(safeMinutes / 60)
  const minute = safeMinutes % 60

  if (hour === 0) {
    return `${minute}분`
  }

  if (minute === 0) {
    return `${hour}시간`
  }

  return `${hour}시간 ${minute}분`
}

export function premiumStartText(premiumStartTimestamp: number, baseDayKey: string): string {
  const targetDayKey = dayKeyFromTimestamp(premiumStartTimestamp)
  const time = clockText(minutesFromMidnightForTimestamp(premiumStartTimestamp))
  const offset = dayOffsetBetween(baseDayKey, targetDayKey)

  if (offset <= 0) {
    return time
  }
  if (offset === 1) {
    return `다음날 ${time}`
  }
  return `${offset}일 후 ${time}`
}

export function dayNumber(dayKey: string): string {
  const parts = parseDayKey(dayKey)
  return String(parts?.day ?? '')
}

export function weekdayColorIndex(dayKey: string): number {
  return new Date(timestampFromDayKey(dayKey)).getUTCDay()
}
