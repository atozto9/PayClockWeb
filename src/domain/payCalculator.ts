import {
  type AppSettings,
  createDefaultDayRecord,
  type DayPayBreakdown,
  type DayRecord,
  type DayStatus,
  normalizeDayRecord,
  normalizeSettings,
  type MonthSummary,
  type PremiumCalculationMode,
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

interface DayContext {
  dayKey: string
  record?: DayRecord
  countsTowardRequiredProgress: boolean
  countsTowardCatchUpDistribution: boolean
}

interface ResolvedWorkday {
  dayKey: string
  record: DayRecord
  holidayName: string | null
  shiftStartTimestamp: number | null
  shiftEndTimestamp: number | null
  effectiveStartTimestamp: number | null
  grossWorkedSeconds: number
  autoBreakMinutes: number
  lunchBreakIsAutomatic: boolean
  extraExcludedMinutes: number
  netWorkedSeconds: number
  isLive: boolean
}

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
  mode: PremiumCalculationMode = 'occurrence',
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
    } satisfies DayContext
  })
  const remainingCatchUpDayCounts = remainingCatchUpDayCountsFor(dayContexts)
  const premiumReferenceDayKey = recommendedReferenceDayKeyForMonth(monthDates, dayKeyFromTimestamp(nowTimestamp))
  const premiumReferenceEffectiveWorkdays = premiumReferenceDayKey === null
    ? 0
    : dayContexts.filter((context) => context.countsTowardRequiredProgress && context.dayKey <= premiumReferenceDayKey).length
  const recommendedHoursToDate = effectiveWorkdays > 0
    ? (requiredHours / effectiveWorkdays) * premiumReferenceEffectiveWorkdays
    : 0

  const dayBreakdowns = mode === 'occurrence'
    ? occurrenceDayBreakdowns(
        dayContexts,
        normalizedSettings,
        baseDailyRequiredHours,
        baseDailyPremiumStartHours,
        remainingCatchUpDayCounts,
        nowTimestamp,
      )
    : settlementDayBreakdowns(
        dayContexts,
        normalizedSettings,
        baseDailyRequiredHours,
        baseDailyPremiumStartHours,
        premiumReferenceDayKey,
        premiumReferenceEffectiveWorkdays,
        nowTimestamp,
      )

  const totalNetWorkedHours = dayBreakdowns.reduce((sum, breakdown) => sum + breakdown.netWorkedSeconds / 3_600, 0)
  const totalPremiumOvertimeHours = dayBreakdowns.reduce((sum, breakdown) => sum + breakdown.premiumOvertimeSeconds / 3_600, 0)
  const totalNightPremiumHours = dayBreakdowns.reduce((sum, breakdown) => sum + breakdown.nightPremiumSeconds / 3_600, 0)
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
    premiumCalculationMode: mode,
    premiumReferenceDayKey,
    recommendedWorkdaysElapsed: premiumReferenceEffectiveWorkdays,
    recommendedHoursToDate,
    totalNetWorkedHours,
    totalRegularOvertimeHours: 0,
    totalPremiumOvertimeHours,
    totalNightPremiumHours,
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
  carryOverShortfallHoursForDay = 0,
): DayPayBreakdown {
  const normalizedSettings = normalizeSettings(settings)
  const resolved = resolvedWorkday(dayKey, record, nowTimestamp)
  const estimatedPremiumStartTimestamp = resolved.shiftStartTimestamp === null
    ? null
    : premiumStartTimestamp(
        resolved.shiftStartTimestamp,
        resolved.record.lunchBreakOverrideMinutes,
        resolved.record.extraExcludedMinutes,
        premiumStartHoursForDay,
      )
  const premiumOvertimeStartTimestamp = resolved.effectiveStartTimestamp === null
    ? null
    : resolved.effectiveStartTimestamp + Math.max(0, premiumStartHoursForDay) * 3_600 * 1_000
  const premiumOvertimeSeconds = premiumOvertimeStartTimestamp === null || resolved.shiftEndTimestamp === null
    ? 0
    : overlapSeconds(
        resolved.effectiveStartTimestamp ?? premiumOvertimeStartTimestamp,
        resolved.shiftEndTimestamp,
        premiumOvertimeStartTimestamp,
        resolved.shiftEndTimestamp,
      )
  const nightPremiumSeconds = nightPremiumSecondsForOccurrence(resolved, premiumOvertimeStartTimestamp)

  return makeBreakdown(
    resolved,
    normalizedSettings,
    requiredHoursForDay,
    premiumStartHoursForDay,
    carryOverShortfallHoursForDay,
    true,
    premiumOvertimeSeconds,
    nightPremiumSeconds,
    resolved.isLive ? estimatedPremiumStartTimestamp : premiumOvertimeStartTimestamp,
  )
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

function occurrenceDayBreakdowns(
  dayContexts: DayContext[],
  settings: AppSettings,
  baseDailyRequiredHours: number,
  baseDailyPremiumStartHours: number,
  remainingCatchUpDayCounts: number[],
  nowTimestamp: number,
): DayPayBreakdown[] {
  const dayBreakdowns: DayPayBreakdown[] = []
  let actualWorkedBeforeHours = 0
  let completedRequiredProgressDays = 0

  for (const [index, context] of dayContexts.entries()) {
    const expectedPremiumBeforeHours = baseDailyPremiumStartHours * completedRequiredProgressDays
    const premiumShortfallBeforeHours = Math.max(0, expectedPremiumBeforeHours - actualWorkedBeforeHours)
    const carryOverShortfallHoursForDay = remainingCatchUpDayCounts[index] > 0
      ? premiumShortfallBeforeHours / remainingCatchUpDayCounts[index]
      : 0
    const dayPremiumStartHours = baseDailyPremiumStartHours + carryOverShortfallHoursForDay
    const breakdown = breakdownForDay(
      context.dayKey,
      context.record,
      settings,
      baseDailyRequiredHours,
      dayPremiumStartHours,
      nowTimestamp,
      carryOverShortfallHoursForDay,
    )

    dayBreakdowns.push(breakdown)
    actualWorkedBeforeHours += breakdown.netWorkedSeconds / 3_600

    if (context.countsTowardRequiredProgress) {
      completedRequiredProgressDays += 1
    }
  }

  return dayBreakdowns
}

function settlementDayBreakdowns(
  dayContexts: DayContext[],
  settings: AppSettings,
  baseDailyRequiredHours: number,
  baseDailyPremiumStartHours: number,
  premiumReferenceDayKey: string | null,
  premiumReferenceEffectiveWorkdays: number,
  nowTimestamp: number,
): DayPayBreakdown[] {
  const resolvedDays = dayContexts.map((context) => resolvedWorkday(context.dayKey, context.record, nowTimestamp))
  const referencedIndices = dayContexts
    .map((context, index) => ({ context, index }))
    .filter(({ context }) => premiumReferenceDayKey !== null && context.dayKey <= premiumReferenceDayKey)
    .map(({ index }) => index)

  const referencedWorkedSeconds = referencedIndices.reduce((sum, index) => sum + resolvedDays[index].netWorkedSeconds, 0)
  const nonPremiumBudgetSeconds = Math.max(0, baseDailyPremiumStartHours) * 3_600 * premiumReferenceEffectiveWorkdays
  let remainingPremiumSeconds = Math.max(0, referencedWorkedSeconds - nonPremiumBudgetSeconds)
  const allocatedNightSeconds = Array.from({ length: dayContexts.length }, () => 0)
  const allocatedNonNightSeconds = Array.from({ length: dayContexts.length }, () => 0)

  for (const index of [...referencedIndices].reverse()) {
    const nightCandidateSeconds = settlementNightCandidateSeconds(resolvedDays[index])
    const allocatedSeconds = Math.min(nightCandidateSeconds, remainingPremiumSeconds)
    allocatedNightSeconds[index] = allocatedSeconds
    remainingPremiumSeconds -= allocatedSeconds
  }

  for (const index of [...referencedIndices].reverse()) {
    const nonNightCandidateSeconds = Math.max(0, resolvedDays[index].netWorkedSeconds - settlementNightCandidateSeconds(resolvedDays[index]))
    const allocatedSeconds = Math.min(nonNightCandidateSeconds, remainingPremiumSeconds)
    allocatedNonNightSeconds[index] = allocatedSeconds
    remainingPremiumSeconds -= allocatedSeconds
  }

  return dayContexts.map((_, index) => {
    const resolved = resolvedDays[index]
    const isWithinPremiumReference = referencedIndices.includes(index)
    const premiumOvertimeSeconds = allocatedNightSeconds[index] + allocatedNonNightSeconds[index]
    const nonPremiumWorkedSeconds = Math.max(0, resolved.netWorkedSeconds - premiumOvertimeSeconds)
    const premiumStartTimestamp = premiumOvertimeSeconds > 0 && resolved.effectiveStartTimestamp !== null
      ? resolved.effectiveStartTimestamp + nonPremiumWorkedSeconds * 1_000
      : null

    return makeBreakdown(
      resolved,
      settings,
      baseDailyRequiredHours,
      premiumOvertimeSeconds > 0 ? nonPremiumWorkedSeconds / 3_600 : 0,
      0,
      isWithinPremiumReference,
      premiumOvertimeSeconds,
      allocatedNightSeconds[index],
      premiumStartTimestamp,
    )
  })
}

function resolvedWorkday(dayKey: string, record: DayRecord | undefined, nowTimestamp: number): ResolvedWorkday {
  const holidayName = holidayNameForDayKey(dayKey)
  const normalizedRecord = record ? normalizeDayRecord(record) : createDefaultDayRecord(dayKey, defaultStatusForDay(dayKey))
  const status = normalizedRecord.status

  if (status !== 'work' || normalizedRecord.startMinute === null) {
    return {
      dayKey,
      record: normalizedRecord,
      holidayName,
      shiftStartTimestamp: null,
      shiftEndTimestamp: null,
      effectiveStartTimestamp: null,
      grossWorkedSeconds: 0,
      autoBreakMinutes: 0,
      lunchBreakIsAutomatic: normalizedRecord.lunchBreakOverrideMinutes === null,
      extraExcludedMinutes: normalizedRecord.extraExcludedMinutes,
      netWorkedSeconds: 0,
      isLive: normalizedRecord.isRunning,
    }
  }

  const shiftStartTimestamp = combineDayAndMinutes(dayKey, normalizedRecord.startMinute)
  let shiftEndTimestamp: number | null = null

  if (normalizedRecord.isRunning) {
    shiftEndTimestamp = Math.max(nowTimestamp, shiftStartTimestamp)
  } else if (normalizedRecord.endMinute !== null) {
    shiftEndTimestamp = combineDayAndMinutes(dayKey, normalizedRecord.endMinute, normalizedRecord.endsNextDay)
  }

  if (shiftEndTimestamp === null || shiftEndTimestamp <= shiftStartTimestamp) {
    return {
      dayKey,
      record: normalizedRecord,
      holidayName,
      shiftStartTimestamp,
      shiftEndTimestamp: null,
      effectiveStartTimestamp: null,
      grossWorkedSeconds: 0,
      autoBreakMinutes: 0,
      lunchBreakIsAutomatic: normalizedRecord.lunchBreakOverrideMinutes === null,
      extraExcludedMinutes: normalizedRecord.extraExcludedMinutes,
      netWorkedSeconds: 0,
      isLive: normalizedRecord.isRunning,
    }
  }

  const grossWorkedSeconds = (shiftEndTimestamp - shiftStartTimestamp) / 1_000
  const autoBreakMinutes = resolvedLunchBreakMinutes(grossWorkedSeconds, normalizedRecord.lunchBreakOverrideMinutes)
  const totalExcludedSeconds = (autoBreakMinutes + normalizedRecord.extraExcludedMinutes) * 60
  const excludedSeconds = Math.min(totalExcludedSeconds, grossWorkedSeconds)
  const effectiveStartTimestamp = shiftStartTimestamp + excludedSeconds * 1_000
  const netWorkedSeconds = Math.max(0, (shiftEndTimestamp - effectiveStartTimestamp) / 1_000)

  return {
    dayKey,
    record: normalizedRecord,
    holidayName,
    shiftStartTimestamp,
    shiftEndTimestamp,
    effectiveStartTimestamp,
    grossWorkedSeconds,
    autoBreakMinutes,
    lunchBreakIsAutomatic: normalizedRecord.lunchBreakOverrideMinutes === null,
    extraExcludedMinutes: normalizedRecord.extraExcludedMinutes,
    netWorkedSeconds,
    isLive: normalizedRecord.isRunning,
  }
}

function makeBreakdown(
  resolved: ResolvedWorkday,
  settings: AppSettings,
  requiredHoursForDay: number,
  premiumStartHoursForDay: number,
  carryOverShortfallHoursForDay: number,
  isWithinPremiumReference: boolean,
  premiumOvertimeSeconds: number,
  nightPremiumSeconds: number,
  premiumStartTimestamp: number | null,
): DayPayBreakdown {
  const hourlyRate = settings.hourlyRate
  const premiumOvertimePay = (premiumOvertimeSeconds / 3_600) * hourlyRate * 1.5
  const nightPremiumPay = (nightPremiumSeconds / 3_600) * hourlyRate * 0.5
  const totalPay = premiumOvertimePay + nightPremiumPay

  return {
    dayKey: resolved.dayKey,
    status: resolved.record.status,
    holidayName: resolved.holidayName,
    requiredHoursForDay,
    premiumStartHoursForDay,
    carryOverShortfallHoursForDay,
    isWithinPremiumReference,
    grossWorkedSeconds: resolved.grossWorkedSeconds,
    autoBreakMinutes: resolved.autoBreakMinutes,
    lunchBreakIsAutomatic: resolved.lunchBreakIsAutomatic,
    extraExcludedMinutes: resolved.extraExcludedMinutes,
    netWorkedSeconds: resolved.netWorkedSeconds,
    regularOvertimeSeconds: 0,
    premiumOvertimeSeconds,
    nightPremiumSeconds,
    regularOvertimePay: 0,
    premiumOvertimePay,
    nightPremiumPay,
    totalPay,
    premiumStartTimestamp,
    isLive: resolved.isLive,
  }
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

function nightPremiumSecondsForOccurrence(
  resolved: ResolvedWorkday,
  premiumOvertimeStartTimestamp: number | null,
): number {
  if (
    !resolved.record.nightPremiumEnabled
    || resolved.effectiveStartTimestamp === null
    || resolved.shiftEndTimestamp === null
    || premiumOvertimeStartTimestamp === null
  ) {
    return 0
  }

  const nightStartTimestamp = combineDayAndMinutes(resolved.dayKey, 22 * 60)
  return overlapSeconds(
    resolved.effectiveStartTimestamp,
    resolved.shiftEndTimestamp,
    Math.max(premiumOvertimeStartTimestamp, nightStartTimestamp),
    resolved.shiftEndTimestamp,
  )
}

function settlementNightCandidateSeconds(resolved: ResolvedWorkday): number {
  if (!resolved.record.nightPremiumEnabled || resolved.effectiveStartTimestamp === null || resolved.shiftEndTimestamp === null) {
    return 0
  }

  const nightStartTimestamp = combineDayAndMinutes(resolved.dayKey, 22 * 60)
  return overlapSeconds(
    resolved.effectiveStartTimestamp,
    resolved.shiftEndTimestamp,
    nightStartTimestamp,
    resolved.shiftEndTimestamp,
  )
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

export function dayKeyForTimestamp(timestamp: number): string {
  return dayKeyFromTimestamp(timestamp)
}

function recommendedReferenceDayKeyForMonth(monthDates: string[], nowDayKey: string): string | null {
  const monthStartDayKey = monthDates[0]
  const monthEndDayKey = monthDates[monthDates.length - 1]

  if (nowDayKey < monthStartDayKey) {
    return null
  }

  if (nowDayKey > monthEndDayKey) {
    return monthEndDayKey
  }

  return nowDayKey
}
