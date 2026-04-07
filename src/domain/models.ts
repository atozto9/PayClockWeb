export const dayStatuses = ['work', 'annualLeave', 'businessTrip', 'holiday', 'off'] as const

export type DayStatus = (typeof dayStatuses)[number]

export const dayStatusDisplayName: Record<DayStatus, string> = {
  work: '근무',
  annualLeave: '연차',
  businessTrip: '출장',
  holiday: '공휴일',
  off: '휴무',
}

export function supportsTimeEntry(status: DayStatus): boolean {
  return status === 'work'
}

export interface AppSettings {
  hourlyRate: number
  premiumThresholdHours: number
  refreshIntervalSeconds: number
}

export function createDefaultAppSettings(hourlyRate = 10_000): AppSettings {
  return {
    hourlyRate,
    premiumThresholdHours: 14,
    refreshIntervalSeconds: 1,
  }
}

export function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    hourlyRate: Math.max(0, Math.trunc(settings.hourlyRate)),
    premiumThresholdHours: Math.max(0, settings.premiumThresholdHours),
    refreshIntervalSeconds: Math.max(1, Math.trunc(settings.refreshIntervalSeconds)),
  }
}

export interface DayRecord {
  id: string
  dayKey: string
  status: DayStatus
  startMinute: number | null
  endMinute: number | null
  endsNextDay: boolean
  lunchBreakOverrideMinutes: number | null
  extraExcludedMinutes: number
  nightPremiumEnabled: boolean
  note: string
  isRunning: boolean
}

export interface AppData {
  settings: AppSettings
  records: DayRecord[]
}

export interface DayPayBreakdown {
  dayKey: string
  status: DayStatus
  holidayName: string | null
  grossWorkedSeconds: number
  autoBreakMinutes: number
  lunchBreakIsAutomatic: boolean
  extraExcludedMinutes: number
  netWorkedSeconds: number
  regularOvertimeSeconds: number
  premiumOvertimeSeconds: number
  nightPremiumSeconds: number
  regularOvertimePay: number
  premiumOvertimePay: number
  nightPremiumPay: number
  totalPay: number
  premiumStartTimestamp: number | null
  isLive: boolean
}

export interface MonthSummary {
  monthStartDayKey: string
  daysInMonth: number
  defaultWorkdays: number
  annualLeaveDays: number
  businessTripDays: number
  manualHolidayDays: number
  offDays: number
  effectiveWorkdays: number
  requiredHours: number
  maxAllowedHours: number
  dailyRequiredHours: number
  dailyPremiumStartHours: number
  totalNetWorkedHours: number
  totalRegularOvertimeHours: number
  totalPremiumOvertimeHours: number
  totalPay: number
  days: DayPayBreakdown[]
  exceedsMonthlyCap: boolean
}

export function createAppData(hourlyRate = 10_000): AppData {
  return {
    settings: createDefaultAppSettings(hourlyRate),
    records: [],
  }
}

export function createDefaultDayRecord(dayKey: string, status: DayStatus): DayRecord {
  return {
    id: generateId(),
    dayKey,
    status,
    startMinute: null,
    endMinute: null,
    endsNextDay: false,
    lunchBreakOverrideMinutes: null,
    extraExcludedMinutes: 0,
    nightPremiumEnabled: false,
    note: '',
    isRunning: false,
  }
}

export function normalizeAppData(appData: AppData): AppData {
  return {
    settings: normalizeSettings(appData.settings),
    records: normalizeRecords(appData.records),
  }
}

export function normalizeRecords(records: DayRecord[]): DayRecord[] {
  const deduped = new Map<string, DayRecord>()
  for (const record of records) {
    deduped.set(record.dayKey, normalizeDayRecord(record))
  }

  return [...deduped.values()].sort((left, right) => left.dayKey.localeCompare(right.dayKey))
}

export function normalizeDayRecord(record: DayRecord): DayRecord {
  const normalized: DayRecord = {
    id: normalizeId(record.id),
    dayKey: record.dayKey,
    status: record.status,
    startMinute: normalizeOptionalMinute(record.startMinute),
    endMinute: normalizeOptionalMinute(record.endMinute),
    endsNextDay: Boolean(record.endsNextDay),
    lunchBreakOverrideMinutes: normalizeOptionalBreak(record.lunchBreakOverrideMinutes),
    extraExcludedMinutes: Math.max(0, Math.trunc(record.extraExcludedMinutes)),
    nightPremiumEnabled: Boolean(record.nightPremiumEnabled),
    note: record.note.trim(),
    isRunning: Boolean(record.isRunning),
  }

  if (!supportsTimeEntry(normalized.status)) {
    normalized.startMinute = null
    normalized.endMinute = null
    normalized.endsNextDay = false
    normalized.lunchBreakOverrideMinutes = null
    normalized.extraExcludedMinutes = 0
    normalized.nightPremiumEnabled = false
    normalized.isRunning = false
  }

  if (normalized.startMinute === null) {
    normalized.endMinute = null
    normalized.endsNextDay = false
    normalized.lunchBreakOverrideMinutes = null
    normalized.nightPremiumEnabled = false
    normalized.isRunning = false
  }

  if (normalized.isRunning) {
    normalized.endMinute = null
  }

  return normalized
}

function normalizeOptionalMinute(value: number | null): number | null {
  if (value === null || Number.isNaN(value)) {
    return null
  }

  return Math.max(0, Math.min(1_439, Math.trunc(value)))
}

function normalizeOptionalBreak(value: number | null): number | null {
  if (value === null || Number.isNaN(value)) {
    return null
  }

  return Math.max(0, Math.min(1_440, Math.trunc(value)))
}

function normalizeId(id: string): string {
  if (typeof id === 'string' && id.length > 0) {
    return id
  }

  return generateId()
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `payclock-${Math.random().toString(36).slice(2)}`
}
