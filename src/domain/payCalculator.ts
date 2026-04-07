import {
  type AppSettings,
  createDefaultDayRecord,
  type DayPayBreakdown,
  type DayRecord,
  type DayStatus,
  normalizeDayRecord,
  normalizeSettings,
  type MonthSummary,
} from './models'
import {
  combineDayAndMinutes,
  currentKoreanTimestamp,
  datesInMonth,
  dayKeyFromTimestamp,
  isWeekday,
  startOfMonth,
} from './payclockCalendar'
import { holidayNameForDayKey, isHolidayDay } from './holidayProvider'

const requiredHourDeductionStatuses = new Set<DayStatus>(['annualLeave', 'businessTrip', 'holiday', 'off'])

export function defaultStatusForDay(dayKey: string): DayStatus {
  if (isHolidayDay(dayKey)) {
    return 'holiday'
  }

  if (isWeekday(dayKey)) {
    return 'work'
  }

  return 'off'
}

export function summarizeMonth(
  containingMonthDayKey: string,
  records: DayRecord[],
  settings: AppSettings,
  nowTimestamp = currentKoreanTimestamp(),
): MonthSummary {
  const normalizedSettings = normalizeSettings(settings)
  const monthDates = datesInMonth(containingMonthDayKey)
  const normalizedRecords = new Map<string, DayRecord>()

  for (const record of records) {
    normalizedRecords.set(record.dayKey, normalizeDayRecord(record))
  }

  const defaultWorkdays = monthDates.filter((dayKey) => isWeekday(dayKey) && !isHolidayDay(dayKey)).length
  const weekdayStatusCounts = new Map<DayStatus, number>()

  for (const dayKey of monthDates) {
    if (!isWeekday(dayKey) || isHolidayDay(dayKey)) {
      continue
    }

    const status = normalizedRecords.get(dayKey)?.status ?? defaultStatusForDay(dayKey)
    weekdayStatusCounts.set(status, (weekdayStatusCounts.get(status) ?? 0) + 1)
  }

  const annualLeaveDays = weekdayStatusCounts.get('annualLeave') ?? 0
  const businessTripDays = weekdayStatusCounts.get('businessTrip') ?? 0
  const manualHolidayDays = weekdayStatusCounts.get('holiday') ?? 0
  const offDays = weekdayStatusCounts.get('off') ?? 0

  const monthLength = monthDates.length
  const weekdayRequiredHours = defaultWorkdays * 8
  const weeklyCapRequiredHours = (40 / 7) * monthLength
  let deductedEightHourDays = 0

  for (const [status, count] of weekdayStatusCounts.entries()) {
    if (requiredHourDeductionStatuses.has(status)) {
      deductedEightHourDays += count
    }
  }

  const requiredHours = Math.floor(Math.max(0, Math.min(weekdayRequiredHours, weeklyCapRequiredHours) - deductedEightHourDays * 8))
  const maxAllowedHours = Math.floor((52 / 7) * monthLength)
  const effectiveWorkdays = Math.max(0, defaultWorkdays - deductedEightHourDays)
  const baseDailyRequiredHours = effectiveWorkdays > 0 ? requiredHours / effectiveWorkdays : 0
  const baseDailyPremiumShareHours = effectiveWorkdays > 0
    ? normalizedSettings.premiumThresholdHours / effectiveWorkdays
    : 0
  const baseDailyPremiumStartHours = baseDailyRequiredHours + baseDailyPremiumShareHours
  const dayContexts = monthDates.map((dayKey) => {
    const record = normalizedRecords.get(dayKey)
    const status = record?.status ?? defaultStatusForDay(dayKey)
    const countsTowardRequiredProgress = countsTowardRequiredProgressForDay(dayKey, status)

    return {
      dayKey,
      record,
      countsTowardRequiredProgress,
      countsTowardCatchUpDistribution: countsTowardRequiredProgress,
    }
  })
  const remainingCatchUpDayCounts = remainingCatchUpDayCountsFor(dayContexts)

  const dayBreakdowns: DayPayBreakdown[] = []
  let actualWorkedBeforeHours = 0
  let completedRequiredProgressDays = 0

  for (const [index, context] of dayContexts.entries()) {
    const expectedRequiredBeforeHours = baseDailyRequiredHours * completedRequiredProgressDays
    const requiredShortfallBeforeHours = Math.max(0, expectedRequiredBeforeHours - actualWorkedBeforeHours)
    const catchUpPerRemainingDayHours = remainingCatchUpDayCounts[index] > 0
      ? requiredShortfallBeforeHours / remainingCatchUpDayCounts[index]
      : 0
    const requiredHoursForDay = baseDailyRequiredHours + catchUpPerRemainingDayHours
    const premiumStartHoursForDay = requiredHoursForDay + baseDailyPremiumShareHours
    const breakdown = breakdownForDay(
      context.dayKey,
      context.record,
      normalizedSettings,
      requiredHoursForDay,
      premiumStartHoursForDay,
      nowTimestamp,
    )

    dayBreakdowns.push(breakdown)
    actualWorkedBeforeHours += breakdown.netWorkedSeconds / 3_600

    if (context.countsTowardRequiredProgress) {
      completedRequiredProgressDays += 1
    }
  }

  const totalNetWorkedHours = dayBreakdowns.reduce((sum, breakdown) => sum + breakdown.netWorkedSeconds / 3_600, 0)
  const totalPremiumOvertimeHours = dayBreakdowns.reduce((sum, breakdown) => sum + breakdown.premiumOvertimeSeconds / 3_600, 0)
  const totalPay = dayBreakdowns.reduce((sum, breakdown) => sum + breakdown.totalPay, 0)

  return {
    monthStartDayKey: startOfMonth(containingMonthDayKey),
    daysInMonth: monthLength,
    defaultWorkdays,
    annualLeaveDays,
    businessTripDays,
    manualHolidayDays,
    offDays,
    effectiveWorkdays,
    requiredHours,
    maxAllowedHours,
    baseDailyRequiredHours,
    baseDailyPremiumStartHours,
    totalNetWorkedHours,
    totalRegularOvertimeHours: 0,
    totalPremiumOvertimeHours,
    totalPay,
    days: dayBreakdowns,
    exceedsMonthlyCap: totalNetWorkedHours > maxAllowedHours,
  }
}

export function breakdownForDay(
  dayKey: string,
  record: DayRecord | undefined,
  settings: AppSettings,
  requiredHoursForDay: number,
  premiumStartHoursForDay: number,
  nowTimestamp = currentKoreanTimestamp(),
): DayPayBreakdown {
  const holidayName = holidayNameForDayKey(dayKey)
  const normalizedSettings = normalizeSettings(settings)
  const normalizedRecord = record ? normalizeDayRecord(record) : createDefaultDayRecord(dayKey, defaultStatusForDay(dayKey))
  const status = normalizedRecord.status

  if (status !== 'work' || normalizedRecord.startMinute === null) {
    return emptyBreakdown(dayKey, status, holidayName, requiredHoursForDay, premiumStartHoursForDay)
  }

  const shiftStartTimestamp = combineDayAndMinutes(dayKey, normalizedRecord.startMinute)
  const estimatedPremiumStartTimestamp = premiumStartTimestamp(
    shiftStartTimestamp,
    normalizedRecord.lunchBreakOverrideMinutes,
    normalizedRecord.extraExcludedMinutes,
    premiumStartHoursForDay,
  )

  let shiftEndTimestamp: number | null = null
  if (normalizedRecord.isRunning) {
    shiftEndTimestamp = Math.max(nowTimestamp, shiftStartTimestamp)
  } else if (normalizedRecord.endMinute !== null) {
    shiftEndTimestamp = combineDayAndMinutes(dayKey, normalizedRecord.endMinute, normalizedRecord.endsNextDay)
  }

  if (shiftEndTimestamp === null || shiftEndTimestamp <= shiftStartTimestamp) {
    return {
      ...emptyBreakdown(dayKey, status, holidayName, requiredHoursForDay, premiumStartHoursForDay),
      lunchBreakIsAutomatic: normalizedRecord.lunchBreakOverrideMinutes === null,
      extraExcludedMinutes: normalizedRecord.extraExcludedMinutes,
      premiumStartTimestamp: estimatedPremiumStartTimestamp,
      isLive: normalizedRecord.isRunning,
    }
  }

  const grossWorkedSeconds = (shiftEndTimestamp - shiftStartTimestamp) / 1_000
  const autoBreakMinutes = resolvedLunchBreakMinutes(grossWorkedSeconds, normalizedRecord.lunchBreakOverrideMinutes)
  const totalExcludedSeconds = (autoBreakMinutes + normalizedRecord.extraExcludedMinutes) * 60
  const excludedSeconds = Math.min(totalExcludedSeconds, grossWorkedSeconds)
  const effectiveStartTimestamp = shiftStartTimestamp + excludedSeconds * 1_000
  const netWorkedSeconds = Math.max(0, (shiftEndTimestamp - effectiveStartTimestamp) / 1_000)
  const premiumOvertimeStartTimestamp = effectiveStartTimestamp + Math.max(0, premiumStartHoursForDay) * 3_600 * 1_000
  const premiumOvertimeSeconds = overlapSeconds(
    effectiveStartTimestamp,
    shiftEndTimestamp,
    premiumOvertimeStartTimestamp,
    shiftEndTimestamp,
  )

  let nightPremiumSeconds = 0
  if (normalizedRecord.nightPremiumEnabled) {
    const nightStartTimestamp = combineDayAndMinutes(dayKey, 22 * 60)
    nightPremiumSeconds = overlapSeconds(
      effectiveStartTimestamp,
      shiftEndTimestamp,
      Math.max(premiumOvertimeStartTimestamp, nightStartTimestamp),
      shiftEndTimestamp,
    )
  }

  const hourlyRate = normalizedSettings.hourlyRate
  const premiumOvertimePay = (premiumOvertimeSeconds / 3_600) * hourlyRate * 1.5
  const nightPremiumPay = (nightPremiumSeconds / 3_600) * hourlyRate * 0.5
  const totalPay = premiumOvertimePay + nightPremiumPay

  return {
    dayKey,
    status,
    holidayName,
    requiredHoursForDay,
    premiumStartHoursForDay,
    grossWorkedSeconds,
    autoBreakMinutes,
    lunchBreakIsAutomatic: normalizedRecord.lunchBreakOverrideMinutes === null,
    extraExcludedMinutes: normalizedRecord.extraExcludedMinutes,
    netWorkedSeconds,
    regularOvertimeSeconds: 0,
    premiumOvertimeSeconds,
    nightPremiumSeconds,
    regularOvertimePay: 0,
    premiumOvertimePay,
    nightPremiumPay,
    totalPay,
    premiumStartTimestamp: normalizedRecord.isRunning ? estimatedPremiumStartTimestamp : premiumOvertimeStartTimestamp,
    isLive: normalizedRecord.isRunning,
  }
}

export function automaticLunchBreakMinutes(grossWorkedSeconds: number): number {
  if (grossWorkedSeconds <= 4 * 3_600) {
    return 0
  }
  if (grossWorkedSeconds <= 8.5 * 3_600) {
    return 30
  }
  return 60
}

function premiumStartTimestamp(
  shiftStartTimestamp: number,
  lunchBreakOverrideMinutes: number | null,
  extraExcludedMinutes: number,
  premiumStartHoursForDay: number,
): number {
  const baseMinutes = Math.max(0, premiumStartHoursForDay * 60 + Math.max(0, extraExcludedMinutes))
  const lunchBreakMinutes = lunchBreakOverrideMinutes ?? automaticLunchBreakMinutesForTargetBoundary(baseMinutes)
  return shiftStartTimestamp + (baseMinutes + lunchBreakMinutes) * 60 * 1_000
}

function automaticLunchBreakMinutesForTargetBoundary(baseMinutes: number): number {
  if (baseMinutes <= 4 * 60) {
    return 0
  }
  if (baseMinutes + 30 <= 8.5 * 60) {
    return 30
  }
  return 60
}

function resolvedLunchBreakMinutes(grossWorkedSeconds: number, overrideMinutes: number | null): number {
  return overrideMinutes ?? automaticLunchBreakMinutes(grossWorkedSeconds)
}

function overlapSeconds(
  intervalStartTimestamp: number,
  intervalEndTimestamp: number,
  rangeStartTimestamp: number,
  rangeEndTimestamp: number,
): number {
  const start = Math.max(intervalStartTimestamp, rangeStartTimestamp)
  const end = Math.min(intervalEndTimestamp, rangeEndTimestamp)
  return Math.max(0, (end - start) / 1_000)
}

function countsTowardRequiredProgressForDay(dayKey: string, status: DayStatus): boolean {
  return isWeekday(dayKey) && !isHolidayDay(dayKey) && status === 'work'
}

function remainingCatchUpDayCountsFor(
  dayContexts: Array<{ countsTowardCatchUpDistribution: boolean }>,
): number[] {
  const remainingCounts = Array.from({ length: dayContexts.length }, () => 0)
  let runningCount = 0

  for (let index = dayContexts.length - 1; index >= 0; index -= 1) {
    if (dayContexts[index].countsTowardCatchUpDistribution) {
      runningCount += 1
    }
    remainingCounts[index] = runningCount
  }

  return remainingCounts
}

function emptyBreakdown(
  dayKey: string,
  status: DayStatus,
  holidayName: string | null,
  requiredHoursForDay = 0,
  premiumStartHoursForDay = 0,
): DayPayBreakdown {
  return {
    dayKey,
    status,
    holidayName,
    requiredHoursForDay,
    premiumStartHoursForDay,
    grossWorkedSeconds: 0,
    autoBreakMinutes: 0,
    lunchBreakIsAutomatic: true,
    extraExcludedMinutes: 0,
    netWorkedSeconds: 0,
    regularOvertimeSeconds: 0,
    premiumOvertimeSeconds: 0,
    nightPremiumSeconds: 0,
    regularOvertimePay: 0,
    premiumOvertimePay: 0,
    nightPremiumPay: 0,
    totalPay: 0,
    premiumStartTimestamp: null,
    isLive: false,
  }
}

export function dayKeyForTimestamp(timestamp: number): string {
  return dayKeyFromTimestamp(timestamp)
}
