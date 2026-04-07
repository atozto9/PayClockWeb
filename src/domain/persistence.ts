import {
  createAppData,
  type AppData,
  type AppSettings,
  createDefaultDayRecord,
  dayStatuses,
  type DayRecord,
  normalizeAppData,
  normalizeRecords,
} from './models'

const currentCSVHeader =
  'dayKey,status,startMinute,endMinute,endsNextDay,lunchBreakOverrideMinutes,extraExcludedMinutes,nightPremiumEnabled,isRunning,note'
const legacyCSVHeader =
  'dayKey,status,startMinute,endMinute,endsNextDay,extraExcludedMinutes,nightPremiumEnabled,isRunning,note'

export type PersistenceLoadStatus = 'missing' | 'loadedPrimary' | 'recoveredBackup' | 'failedAndReset'

export interface PersistenceLoadResult {
  data: AppData
  status: PersistenceLoadStatus
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  clear?(): void
}

export class PersistenceError extends Error {
  code: 'invalidCSVHeader' | 'invalidCSVRow' | 'invalidJSON'
  row: number | null

  constructor(code: 'invalidCSVHeader' | 'invalidCSVRow' | 'invalidJSON', row: number | null = null) {
    super(messageForError(code, row))
    this.name = 'PersistenceError'
    this.code = code
    this.row = row
  }
}

export class BrowserPersistenceController {
  readonly primaryKey: string
  readonly backupKey: string
  private readonly storage: StorageLike
  private readonly defaultHourlyRate: number

  constructor(
    primaryKey = 'payclock:data:v1',
    backupKey = 'payclock:data:backup:v1',
    storage = resolveStorage(),
    defaultHourlyRate = 10_000,
  ) {
    this.primaryKey = primaryKey
    this.backupKey = backupKey
    this.storage = storage
    this.defaultHourlyRate = defaultHourlyRate
  }

  load(): AppData {
    return this.loadResult().data
  }

  loadResult(): PersistenceLoadResult {
    const primary = this.storage.getItem(this.primaryKey)
    if (primary === null) {
      return { data: createAppData(this.defaultHourlyRate), status: 'missing' }
    }

    try {
      const data = this.importJSONData(primary)
      return { data, status: 'loadedPrimary' }
    } catch {
      const backup = this.storage.getItem(this.backupKey)
      if (backup === null) {
        return { data: createAppData(this.defaultHourlyRate), status: 'failedAndReset' }
      }

      try {
        const data = this.importJSONData(backup)
        this.restorePrimaryIfNeeded(data)
        return { data, status: 'recoveredBackup' }
      } catch {
        return { data: createAppData(this.defaultHourlyRate), status: 'failedAndReset' }
      }
    }
  }

  save(appData: AppData): void {
    const normalizedData = normalizeAppData(appData)
    const serialized = serializeAppData(normalizedData)
    const backupData = this.trustedPrimaryData()
    this.storage.setItem(this.primaryKey, serialized)
    this.storage.setItem(this.backupKey, backupData ?? serialized)
  }

  exportJSONData(appData: AppData): string {
    return serializeAppData(normalizeAppData(appData))
  }

  importJSONData(input: string): AppData {
    try {
      const parsed = JSON.parse(input)
      return decodeAppData(parsed)
    } catch (error) {
      if (error instanceof PersistenceError) {
        throw error
      }
      throw new PersistenceError('invalidJSON')
    }
  }

  exportCSV(records: DayRecord[]): string {
    const lines = normalizeRecords(records).map((record) =>
      [
        record.dayKey,
        record.status,
        record.startMinute ?? '',
        record.endMinute ?? '',
        record.endsNextDay ? 'true' : 'false',
        record.lunchBreakOverrideMinutes ?? '',
        record.extraExcludedMinutes,
        record.nightPremiumEnabled ? 'true' : 'false',
        record.isRunning ? 'true' : 'false',
        escapeCSV(record.note),
      ].join(','),
    )

    return [currentCSVHeader, ...lines].join('\n')
  }

  importCSV(csv: string): DayRecord[] {
    const rows = csv
      .split(/\r?\n/u)
      .map((row) => row.trimEnd())
      .filter((row) => row.trim().length > 0)

    const header = rows[0]
    const isLegacyHeader = header === legacyCSVHeader
    const isCurrentHeader = header === currentCSVHeader
    if (!header || (!isLegacyHeader && !isCurrentHeader)) {
      throw new PersistenceError('invalidCSVHeader')
    }

    const records = rows.slice(1).map((row, index) => {
      const columns = parseCSVLine(row)
      const expectedColumns = isLegacyHeader ? 9 : 10
      if (columns.length !== expectedColumns) {
        throw new PersistenceError('invalidCSVRow', index + 2)
      }

      const statusText = columns[1]
      if (!dayStatuses.includes(statusText as (typeof dayStatuses)[number])) {
        throw new PersistenceError('invalidCSVRow', index + 2)
      }
      const status = statusText as (typeof dayStatuses)[number]

      const lunchBreakOverrideMinutes = isLegacyHeader ? null : parseOptionalInt(columns[5], index + 2)
      const extraExcludedIndex = isLegacyHeader ? 5 : 6
      const nightPremiumIndex = isLegacyHeader ? 6 : 7
      const isRunningIndex = isLegacyHeader ? 7 : 8
      const noteIndex = isLegacyHeader ? 8 : 9

      return {
        ...createDefaultDayRecord(columns[0], status),
        dayKey: columns[0],
        status,
        startMinute: parseOptionalInt(columns[2], index + 2),
        endMinute: parseOptionalInt(columns[3], index + 2),
        endsNextDay: columns[4].toLowerCase() === 'true',
        lunchBreakOverrideMinutes,
        extraExcludedMinutes: parseInt(columns[extraExcludedIndex] || '0', index + 2),
        nightPremiumEnabled: columns[nightPremiumIndex].toLowerCase() === 'true',
        note: columns[noteIndex],
        isRunning: columns[isRunningIndex].toLowerCase() === 'true',
      } satisfies DayRecord
    })

    return normalizeRecords(records)
  }

  private trustedPrimaryData(): string | null {
    const primary = this.storage.getItem(this.primaryKey)
    if (primary === null) {
      return null
    }

    try {
      this.importJSONData(primary)
      return primary
    } catch {
      return null
    }
  }

  private restorePrimaryIfNeeded(appData: AppData): void {
    this.storage.setItem(this.primaryKey, serializeAppData(normalizeAppData(appData)))
  }
}

export function createMemoryStorage(initialEntries?: Record<string, string>): StorageLike {
  const store = new Map<string, string>(Object.entries(initialEntries ?? {}))

  return {
    getItem(key) {
      return store.get(key) ?? null
    },
    setItem(key, value) {
      store.set(key, value)
    },
    removeItem(key) {
      store.delete(key)
    },
  }
}

function resolveStorage(): StorageLike {
  const browserStorage = typeof window !== 'undefined' ? window.localStorage : undefined
  if (isStorageLike(browserStorage)) {
    return browserStorage
  }

  const globalStorageCandidate = (globalThis as { localStorage?: unknown }).localStorage
  if (isStorageLike(globalStorageCandidate)) {
    return globalStorageCandidate
  }

  return createMemoryStorage()
}

function parseOptionalInt(value: string, row: number): number | null {
  if (value === '') {
    return null
  }

  return parseInt(value, row)
}

function parseInt(value: string, row: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    throw new PersistenceError('invalidCSVRow', row)
  }

  return parsed
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`
  }

  return value
}

function parseCSVLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let insideQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      const next = line[index + 1]
      if (insideQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        insideQuotes = !insideQuotes
      }
    } else if (character === ',' && !insideQuotes) {
      values.push(current)
      current = ''
    } else {
      current += character
    }
  }

  values.push(current)
  return values
}

function serializeAppData(appData: AppData): string {
  const normalized = normalizeAppData(appData)
  return `${JSON.stringify(
    {
      settings: serializeSettings(normalized.settings),
      records: normalized.records.map(serializeRecord),
    },
    null,
    2,
  )}\n`
}

function serializeSettings(settings: AppSettings) {
  return {
    hourlyRate: settings.hourlyRate,
    premiumThresholdHours: settings.premiumThresholdHours,
    refreshIntervalSeconds: settings.refreshIntervalSeconds,
  }
}

function serializeRecord(record: DayRecord) {
  return {
    id: record.id,
    dayKey: record.dayKey,
    status: record.status,
    startMinute: record.startMinute,
    endMinute: record.endMinute,
    endsNextDay: record.endsNextDay,
    lunchBreakOverrideMinutes: record.lunchBreakOverrideMinutes,
    extraExcludedMinutes: record.extraExcludedMinutes,
    nightPremiumEnabled: record.nightPremiumEnabled,
    note: record.note,
    isRunning: record.isRunning,
  }
}

function decodeAppData(input: unknown): AppData {
  if (!isObject(input)) {
    throw new PersistenceError('invalidJSON')
  }

  if (!('settings' in input) || !('records' in input)) {
    throw new PersistenceError('invalidJSON')
  }

  const settings = decodeSettings(input.settings)
  const recordsInput = input.records
  if (!Array.isArray(recordsInput)) {
    throw new PersistenceError('invalidJSON')
  }

  return normalizeAppData({
    settings,
    records: recordsInput.map((record) => decodeRecord(record)),
  })
}

function decodeSettings(input: unknown): AppSettings {
  if (!isObject(input)) {
    throw new PersistenceError('invalidJSON')
  }

  const hourlyRate = input.hourlyRate
  const premiumThresholdHours = input.premiumThresholdHours
  const refreshIntervalSeconds = input.refreshIntervalSeconds

  if (
    typeof hourlyRate !== 'number' ||
    typeof premiumThresholdHours !== 'number' ||
    typeof refreshIntervalSeconds !== 'number'
  ) {
    throw new PersistenceError('invalidJSON')
  }

  return {
    hourlyRate,
    premiumThresholdHours,
    refreshIntervalSeconds,
  }
}

function decodeRecord(input: unknown): DayRecord {
  if (!isObject(input)) {
    throw new PersistenceError('invalidJSON')
  }

  const {
    id,
    dayKey,
    status,
    startMinute,
    endMinute,
    endsNextDay,
    lunchBreakOverrideMinutes,
    extraExcludedMinutes,
    nightPremiumEnabled,
    note,
    isRunning,
  } = input

  if (
    typeof id !== 'string' ||
    typeof dayKey !== 'string' ||
    typeof status !== 'string' ||
    !dayStatuses.includes(status as (typeof dayStatuses)[number]) ||
    !isNullableNumber(startMinute) ||
    !isNullableNumber(endMinute) ||
    typeof endsNextDay !== 'boolean' ||
    !isNullableNumber(lunchBreakOverrideMinutes) ||
    typeof extraExcludedMinutes !== 'number' ||
    typeof nightPremiumEnabled !== 'boolean' ||
    typeof note !== 'string' ||
    typeof isRunning !== 'boolean'
  ) {
    throw new PersistenceError('invalidJSON')
  }

  const normalizedStatus = status as (typeof dayStatuses)[number]

  return {
    id,
    dayKey,
    status: normalizedStatus,
    startMinute,
    endMinute,
    endsNextDay,
    lunchBreakOverrideMinutes,
    extraExcludedMinutes,
    nightPremiumEnabled,
    note,
    isRunning,
  }
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStorageLike(value: unknown): value is StorageLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getItem' in value &&
    typeof value.getItem === 'function' &&
    'setItem' in value &&
    typeof value.setItem === 'function' &&
    'removeItem' in value &&
    typeof value.removeItem === 'function'
  )
}

function messageForError(code: PersistenceError['code'], row: number | null): string {
  switch (code) {
    case 'invalidCSVHeader':
      return 'CSV 헤더가 올바르지 않습니다.'
    case 'invalidCSVRow':
      return `CSV ${row ?? 0}번째 줄을 읽을 수 없습니다.`
    case 'invalidJSON':
      return 'JSON 형식이 올바르지 않습니다.'
  }
}
