import { describe, expect, it } from 'vitest'
import { BrowserPersistenceController, createMemoryStorage } from './persistence'

describe('BrowserPersistenceController', () => {
  it('round-trips business trip through JSON and CSV', () => {
    const persistence = new BrowserPersistenceController('payclock:data:test', 'payclock:backup:test', createMemoryStorage())
    const source = {
      settings: {
        hourlyRate: 24_584,
        premiumThresholdHours: 14,
        refreshIntervalSeconds: 1,
      },
      records: [
        {
          id: crypto.randomUUID(),
          dayKey: '2026-04-09',
          status: 'businessTrip' as const,
          startMinute: null,
          endMinute: null,
          endsNextDay: false,
          lunchBreakOverrideMinutes: null,
          extraExcludedMinutes: 0,
          nightPremiumEnabled: false,
          note: '',
          isRunning: false,
        },
      ],
    }

    const json = persistence.exportJSONData(source)
    const restoredJSON = persistence.importJSONData(json)
    const csv = persistence.exportCSV(source.records)
    const restoredCSV = persistence.importCSV(csv)

    expect(restoredJSON.records[0]?.status).toBe('businessTrip')
    expect(restoredCSV[0]?.status).toBe('businessTrip')
  })

  it('deduplicates and sorts imported CSV rows', () => {
    const persistence = new BrowserPersistenceController('payclock:data:test', 'payclock:backup:test', createMemoryStorage())
    const csv = `dayKey,status,startMinute,endMinute,endsNextDay,lunchBreakOverrideMinutes,extraExcludedMinutes,nightPremiumEnabled,isRunning,note
2026-04-10,work,540,1080,false,,0,false,false,둘째
2026-04-09,work,540,1020,false,,0,false,false,원본
2026-04-09,work,600,1140,false,,0,false,false,최종`

    const records = persistence.importCSV(csv)
    expect(records.map((record) => record.dayKey)).toEqual(['2026-04-09', '2026-04-10'])
    expect(records[0]?.startMinute).toBe(600)
    expect(records[0]?.note).toBe('최종')
  })

  it('preserves all fields through save/load', () => {
    const storage = createMemoryStorage()
    const persistence = new BrowserPersistenceController('payclock:data:test', 'payclock:backup:test', storage)
    const source = {
      settings: {
        hourlyRate: 12_345,
        premiumThresholdHours: 12.5,
        refreshIntervalSeconds: 30,
      },
      records: [
        {
          id: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
          dayKey: '2026-04-09',
          status: 'work' as const,
          startMinute: 9 * 60,
          endMinute: 23 * 60,
          endsNextDay: true,
          lunchBreakOverrideMinutes: 60,
          extraExcludedMinutes: 15,
          nightPremiumEnabled: true,
          note: '야간 근무',
          isRunning: false,
        },
        {
          id: '11111111-2222-3333-4444-555555555555',
          dayKey: '2026-04-10',
          status: 'businessTrip' as const,
          startMinute: null,
          endMinute: null,
          endsNextDay: false,
          lunchBreakOverrideMinutes: null,
          extraExcludedMinutes: 0,
          nightPremiumEnabled: false,
          note: '외근',
          isRunning: false,
        },
      ],
    }

    persistence.save(source)
    expect(persistence.load()).toEqual(source)
  })

  it('recovers from backup when primary JSON is corrupt', () => {
    const storage = createMemoryStorage()
    const persistence = new BrowserPersistenceController('payclock:data:test', 'payclock:backup:test', storage)
    const backupData = {
      settings: { hourlyRate: 100, premiumThresholdHours: 14, refreshIntervalSeconds: 10 },
      records: [
        {
          id: crypto.randomUUID(),
          dayKey: '2026-04-09',
          status: 'annualLeave' as const,
          startMinute: null,
          endMinute: null,
          endsNextDay: false,
          lunchBreakOverrideMinutes: null,
          extraExcludedMinutes: 0,
          nightPremiumEnabled: false,
          note: '',
          isRunning: false,
        },
      ],
    }
    const currentData = {
      settings: { hourlyRate: 200, premiumThresholdHours: 7, refreshIntervalSeconds: 20 },
      records: [
        {
          id: crypto.randomUUID(),
          dayKey: '2026-04-10',
          status: 'businessTrip' as const,
          startMinute: null,
          endMinute: null,
          endsNextDay: false,
          lunchBreakOverrideMinutes: null,
          extraExcludedMinutes: 0,
          nightPremiumEnabled: false,
          note: '',
          isRunning: false,
        },
      ],
    }

    persistence.save(backupData)
    persistence.save(currentData)
    storage.setItem('payclock:data:test', 'invalid json')

    const result = persistence.loadResult()
    expect(result.status).toBe('recoveredBackup')
    expect(result.data).toEqual(backupData)
    expect(persistence.load()).toEqual(backupData)
  })

  it('resets when primary and backup are both invalid', () => {
    const storage = createMemoryStorage()
    const persistence = new BrowserPersistenceController('payclock:data:test', 'payclock:backup:test', storage)

    persistence.save({
      settings: { hourlyRate: 100, premiumThresholdHours: 14, refreshIntervalSeconds: 10 },
      records: [],
    })
    persistence.save({
      settings: { hourlyRate: 200, premiumThresholdHours: 7, refreshIntervalSeconds: 20 },
      records: [],
    })
    storage.setItem('payclock:data:test', 'invalid primary')
    storage.setItem('payclock:backup:test', 'invalid backup')

    const result = persistence.loadResult()
    expect(result.status).toBe('failedAndReset')
    expect(result.data.settings.hourlyRate).toBe(10_000)
    expect(result.data.records).toEqual([])
  })

  it('keeps backup valid after recovery and a new save', () => {
    const storage = createMemoryStorage()
    const persistence = new BrowserPersistenceController('payclock:data:test', 'payclock:backup:test', storage)
    const backupData = {
      settings: { hourlyRate: 100, premiumThresholdHours: 14, refreshIntervalSeconds: 10 },
      records: [],
    }
    const currentData = {
      settings: { hourlyRate: 200, premiumThresholdHours: 7, refreshIntervalSeconds: 20 },
      records: [],
    }
    const updatedData = {
      settings: { hourlyRate: 300, premiumThresholdHours: 5, refreshIntervalSeconds: 30 },
      records: [
        {
          id: crypto.randomUUID(),
          dayKey: '2026-04-11',
          status: 'work' as const,
          startMinute: 9 * 60,
          endMinute: 18 * 60,
          endsNextDay: false,
          lunchBreakOverrideMinutes: null,
          extraExcludedMinutes: 0,
          nightPremiumEnabled: false,
          note: '',
          isRunning: false,
        },
      ],
    }

    persistence.save(backupData)
    persistence.save(currentData)
    storage.setItem('payclock:data:test', 'invalid json')

    expect(persistence.loadResult().status).toBe('recoveredBackup')
    persistence.save(updatedData)

    const restoredBackup = persistence.importJSONData(storage.getItem('payclock:backup:test') ?? '')
    expect(persistence.load()).toEqual(updatedData)
    expect(restoredBackup).toEqual(backupData)
  })
})
