import { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  createAppData,
  createDefaultDayRecord,
  type AppData,
  type DayPayBreakdown,
  type DayRecord,
  normalizeAppData,
  normalizeDayRecord,
} from '../domain/models'
import { breakdownForDay, defaultStatusForDay, summarizeMonth } from '../domain/payCalculator'
import { BrowserPersistenceController, type PersistenceLoadStatus } from '../domain/persistence'
import {
  combineDayAndMinutes,
  currentKoreanTimestamp,
  dayKeyFromTimestamp,
  minutesFromMidnightForTimestamp,
  monthByAdding,
  monthContains,
  startOfMonth,
} from '../domain/payclockCalendar'

export function useAppModel() {
  const persistenceRef = useRef<BrowserPersistenceController>(new BrowserPersistenceController())
  const initialLoadResultRef = useRef(persistenceRef.current.loadResult())
  const initialNowTimestampRef = useRef(currentKoreanTimestamp())
  const initialTodayKey = dayKeyFromTimestamp(initialNowTimestampRef.current)

  const [data, setData] = useState<AppData>(initialLoadResultRef.current.data)
  const [selectedMonth, setSelectedMonth] = useState(startOfMonth(initialTodayKey))
  const [selectedDate, setSelectedDate] = useState(initialTodayKey)
  const [nowTimestamp, setNowTimestamp] = useState(initialNowTimestampRef.current)
  const [errorMessage, setErrorMessage] = useState<string | null>(messageForLoadStatus(initialLoadResultRef.current.status))
  const [pendingJSONImport, setPendingJSONImport] = useState<AppData | null>(null)

  const activeRunningDayKey = data.records.find((record) => record.isRunning)?.dayKey ?? null
  const todayKey = dayKeyFromTimestamp(nowTimestamp)
  const monthSummary = summarizeMonth(selectedMonth, data.records, data.settings, nowTimestamp)
  const dayMap = new Map(monthSummary.days.map((day) => [day.dayKey, day] as const))

  const refreshNow = useEffectEvent(() => {
    setNowTimestamp(currentKoreanTimestamp())
  })

  useEffect(() => {
    refreshNow()

    if (!activeRunningDayKey) {
      return undefined
    }

    const interval = window.setInterval(() => {
      refreshNow()
    }, Math.max(1, data.settings.refreshIntervalSeconds) * 1_000)

    return () => window.clearInterval(interval)
  }, [activeRunningDayKey, data.settings.refreshIntervalSeconds])

  function summaryForMonth(monthDayKey: string) {
    return summarizeMonth(monthDayKey, data.records, data.settings, nowTimestamp)
  }

  function breakdownForDate(dayKey: string): DayPayBreakdown {
    const summary = summaryForMonth(startOfMonth(dayKey))
    return summary.days.find((day) => day.dayKey === dayKey) ?? breakdownForDay(dayKey, undefined, data.settings, 0, 0, nowTimestamp)
  }

  function liveBreakdown(): DayPayBreakdown {
    if (activeRunningDayKey) {
      return breakdownForDate(activeRunningDayKey)
    }

    return breakdownForDate(todayKey)
  }

  function recordFor(dayKey: string): DayRecord {
    return data.records.find((record) => record.dayKey === dayKey) ?? createDefaultDayRecord(dayKey, defaultStatusForDay(dayKey))
  }

  function selectDate(dayKey: string) {
    startTransition(() => {
      setSelectedDate(dayKey)
      if (!monthContains(selectedMonth, dayKey)) {
        setSelectedMonth(startOfMonth(dayKey))
      }
    })
  }

  function moveMonth(offset: number) {
    startTransition(() => {
      setSelectedMonth((previousMonth) => {
        const nextMonth = monthByAdding(offset, previousMonth)
        if (!monthContains(nextMonth, selectedDate)) {
          setSelectedDate(nextMonth)
        }
        return nextMonth
      })
    })
  }

  function goToToday() {
    const nextNow = currentKoreanTimestamp()
    const nextTodayKey = dayKeyFromTimestamp(nextNow)
    setNowTimestamp(nextNow)
    startTransition(() => {
      setSelectedMonth(startOfMonth(nextTodayKey))
      setSelectedDate(nextTodayKey)
    })
  }

  function resetDate(dayKey: string) {
    persist({
      settings: data.settings,
      records: data.records.filter((record) => record.dayKey !== dayKey),
    })
  }

  function setHourlyRate(value: number) {
    persist({
      ...data,
      settings: {
        ...data.settings,
        hourlyRate: Math.max(0, Math.trunc(value || 0)),
      },
    })
  }

  function setPremiumThresholdHours(value: number) {
    persist({
      ...data,
      settings: {
        ...data.settings,
        premiumThresholdHours: Math.max(0, value || 0),
      },
    })
  }

  function setRefreshIntervalSeconds(value: number) {
    persist({
      ...data,
      settings: {
        ...data.settings,
        refreshIntervalSeconds: Math.max(1, Math.trunc(value || 1)),
      },
    })
  }

  function updateRecord(record: DayRecord) {
    const actionTimestamp = currentKoreanTimestamp()
    const actionTodayKey = dayKeyFromTimestamp(actionTimestamp)
    const actionMinute = minutesFromMidnightForTimestamp(actionTimestamp)
    const existing = data.records.find((candidate) => candidate.dayKey === record.dayKey)
    let normalized = normalizeDayRecord(record)

    if (normalized.dayKey !== actionTodayKey && activeRunningDayKey !== normalized.dayKey) {
      normalized = {
        ...normalized,
        isRunning: false,
      }
    }

    if (normalized.isRunning && normalized.startMinute === null) {
      normalized = {
        ...normalized,
        startMinute: actionMinute,
      }
    }

    if (existing?.isRunning && !normalized.isRunning && normalized.endMinute === null) {
      normalized = {
        ...normalized,
        endMinute: actionMinute,
        endsNextDay: normalized.dayKey !== actionTodayKey,
      }
    }

    normalized = normalizeDayRecord(normalized)

    let records = data.records
    if (normalized.isRunning) {
      records = records.map((candidate) =>
        candidate.dayKey === normalized.dayKey
          ? candidate
          : {
              ...candidate,
              isRunning: false,
            },
      )
    }

    const fallback = createDefaultDayRecord(normalized.dayKey, defaultStatusForDay(normalized.dayKey))
    if (isEquivalentToDefault(normalized, fallback)) {
      records = records.filter((candidate) => candidate.dayKey !== normalized.dayKey)
    } else {
      const nextRecords = [...records]
      const index = nextRecords.findIndex((candidate) => candidate.dayKey === normalized.dayKey)
      if (index >= 0) {
        nextRecords[index] = normalized
      } else {
        nextRecords.push(normalized)
      }
      records = nextRecords
    }

    persist({
      settings: data.settings,
      records,
    })
  }

  function confirmPendingJSONImport() {
    if (!pendingJSONImport) {
      return
    }

    persist(pendingJSONImport)
    setPendingJSONImport(null)
  }

  function discardPendingJSONImport() {
    setPendingJSONImport(null)
  }

  function mergeImportedRecords(records: DayRecord[]) {
    const merged = new Map<string, DayRecord>()
    for (const record of data.records) {
      merged.set(record.dayKey, record)
    }
    for (const record of records) {
      merged.set(record.dayKey, record)
    }

    persist({
      settings: data.settings,
      records: [...merged.values()],
    })
  }

  async function importFile(file: File) {
    try {
      const text = await file.text()
      const extension = file.name.split('.').pop()?.toLowerCase()

      if (extension === 'json') {
        setPendingJSONImport(persistenceRef.current.importJSONData(text))
        return
      }

      if (extension === 'csv') {
        mergeImportedRecords(persistenceRef.current.importCSV(text))
        return
      }

      setErrorMessage('지원하지 않는 파일 형식입니다.')
    } catch (error) {
      setErrorMessage(asMessage(error))
    }
  }

  function exportJSON() {
    try {
      const filename = `payclock-${monthSummary.monthStartDayKey}.json`
      const text = persistenceRef.current.exportJSONData(data)
      downloadFile(filename, text, 'application/json;charset=utf-8')
    } catch (error) {
      setErrorMessage(asMessage(error))
    }
  }

  function exportCSV() {
    try {
      const filename = `payclock-${monthSummary.monthStartDayKey}.csv`
      const text = persistenceRef.current.exportCSV(data.records)
      downloadFile(filename, text, 'text/csv;charset=utf-8')
    } catch (error) {
      setErrorMessage(asMessage(error))
    }
  }

  function clearError() {
    setErrorMessage(null)
  }

  return {
    activeRunningDayKey,
    data,
    dayMap,
    errorMessage,
    importFile,
    liveBreakdown: liveBreakdown(),
    monthSummary,
    nowTimestamp,
    pendingJSONImport,
    recordFor,
    selectedDate,
    selectedMonth,
    selectDate,
    moveMonth,
    goToToday,
    resetDate,
    setHourlyRate,
    setPremiumThresholdHours,
    setRefreshIntervalSeconds,
    updateRecord,
    confirmPendingJSONImport,
    discardPendingJSONImport,
    exportJSON,
    exportCSV,
    clearError,
    isSelectedDateToday: selectedDate === todayKey,
    todayKey,
  }

  function persist(nextData: AppData) {
    try {
      const normalized = normalizeAppData(nextData)
      setData(normalized)
      setNowTimestamp(currentKoreanTimestamp())
      persistenceRef.current.save(normalized)
    } catch (error) {
      setErrorMessage(asMessage(error))
    }
  }
}

function isEquivalentToDefault(left: DayRecord, right: DayRecord): boolean {
  const a = normalizeDayRecord(left)
  const b = normalizeDayRecord(right)

  return (
    a.status === b.status &&
    a.startMinute === b.startMinute &&
    a.endMinute === b.endMinute &&
    a.endsNextDay === b.endsNextDay &&
    a.lunchBreakOverrideMinutes === b.lunchBreakOverrideMinutes &&
    a.extraExcludedMinutes === b.extraExcludedMinutes &&
    a.nightPremiumEnabled === b.nightPremiumEnabled &&
    a.isRunning === b.isRunning &&
    a.note.length === 0
  )
}

function messageForLoadStatus(status: PersistenceLoadStatus): string | null {
  switch (status) {
    case 'missing':
    case 'loadedPrimary':
      return null
    case 'recoveredBackup':
      return '데이터 파일이 손상되어 백업에서 복구했습니다.'
    case 'failedAndReset':
      return '데이터 파일을 읽을 수 없어 초기 상태로 시작했습니다.'
  }
}

function asMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return '알 수 없는 문제가 발생했습니다.'
}

function downloadFile(filename: string, contents: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function runningShiftWorkedSeconds(record: DayRecord, nowTimestamp: number): number {
  if (!record.isRunning || record.startMinute === null) {
    return 0
  }

  const shiftStartTimestamp = combineDayAndMinutes(record.dayKey, record.startMinute)
  return Math.max(0, (Math.max(nowTimestamp, shiftStartTimestamp) - shiftStartTimestamp) / 1_000)
}

export function emptyAppData() {
  return createAppData()
}
