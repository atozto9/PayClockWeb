import { describe, expect, it } from 'vitest'
import { createDefaultAppSettings, type DayRecord } from './models'
import { holidayNameForDayKey, isHolidayDay } from './holidayProvider'
import { breakdownForDay, summarizeMonth } from './payCalculator'
import { combineDayAndMinutes, datesInMonth, isWeekday } from './payclockCalendar'

function makeSettings(hourlyRate = 100, premiumThresholdHours = 14, refreshIntervalSeconds = 1) {
  return {
    hourlyRate,
    premiumThresholdHours,
    refreshIntervalSeconds,
  }
}

function workRecord(dayKey: string, overrides: Partial<DayRecord> = {}): DayRecord {
  return {
    id: crypto.randomUUID(),
    dayKey,
    status: 'work',
    startMinute: 9 * 60,
    endMinute: 18 * 60,
    endsNextDay: false,
    lunchBreakOverrideMinutes: null,
    extraExcludedMinutes: 0,
    nightPremiumEnabled: false,
    note: '',
    isRunning: false,
    ...overrides,
  }
}

describe('payCalculator', () => {
  it('includes substitute holiday names', () => {
    expect(isHolidayDay('2026-03-02')).toBe(true)
    expect(holidayNameForDayKey('2026-03-02')).toBe('3·1절 대체공휴일')
  })

  it('subtracts annual leave from april required hours', () => {
    const summary = summarizeMonth('2026-04-01', [{ ...workRecord('2026-04-10'), status: 'annualLeave', startMinute: null, endMinute: null }], makeSettings(), combineDayAndMinutes('2026-04-01', 0))

    expect(summary.defaultWorkdays).toBe(22)
    expect(summary.annualLeaveDays).toBe(1)
    expect(summary.effectiveWorkdays).toBe(21)
    expect(summary.requiredHours).toBe(163)
    expect(summary.maxAllowedHours).toBe(222)
  })

  it('subtracts manual holiday and off days', () => {
    const summary = summarizeMonth(
      '2026-04-01',
      [
        { ...workRecord('2026-04-09'), status: 'holiday', startMinute: null, endMinute: null },
        { ...workRecord('2026-04-10'), status: 'off', startMinute: null, endMinute: null },
      ],
      makeSettings(),
      combineDayAndMinutes('2026-04-01', 0),
    )

    expect(summary.manualHolidayDays).toBe(1)
    expect(summary.offDays).toBe(1)
    expect(summary.effectiveWorkdays).toBe(20)
    expect(summary.requiredHours).toBe(155)
  })

  it('starts premium overtime after distributed threshold', () => {
    const summary = summarizeMonth(
      '2026-08-01',
      [workRecord('2026-08-03', { endMinute: 19 * 60 + 30 })],
      makeSettings(),
      combineDayAndMinutes('2026-08-01', 0),
    )

    const breakdown = summary.days.find((day) => day.dayKey === '2026-08-03')
    expect(summary.baseDailyRequiredHours).toBeCloseTo(8, 4)
    expect(summary.baseDailyPremiumStartHours).toBeCloseTo(8.7, 4)
    expect(breakdown?.requiredHoursForDay).toBeCloseTo(8, 4)
    expect(breakdown?.premiumStartHoursForDay).toBeCloseTo(8.7, 4)
    expect(breakdown?.carryOverShortfallHoursForDay).toBeCloseTo(0, 4)
    expect(breakdown?.premiumOvertimeSeconds).toBeCloseTo(0.8 * 3_600, 3)
    expect(breakdown?.totalPay).toBeCloseTo(120, 3)
  })

  it('redistributes premium-target shortfall across remaining workdays', () => {
    const summary = summarizeMonth(
      '2026-08-01',
      [workRecord('2026-08-04', { endMinute: 19 * 60 + 30 })],
      makeSettings(),
      combineDayAndMinutes('2026-08-01', 0),
    )

    const breakdown = summary.days.find((day) => day.dayKey === '2026-08-04')
    expect(breakdown?.requiredHoursForDay).toBeCloseTo(8, 4)
    expect(breakdown?.carryOverShortfallHoursForDay).toBeCloseTo(8.7 / 19, 4)
    expect(breakdown?.premiumStartHoursForDay).toBeCloseTo(8 + 14 / 20 + 8.7 / 19, 4)
    expect(breakdown?.premiumOvertimeSeconds).toBeCloseTo((9.5 - (8 + 14 / 20 + 8.7 / 19)) * 3_600, 3)
  })

  it('does not lower future thresholds below the base line after earlier overtime', () => {
    const summary = summarizeMonth(
      '2026-08-01',
      [workRecord('2026-08-03', { startMinute: 8 * 60, endMinute: 21 * 60 })],
      makeSettings(),
      combineDayAndMinutes('2026-08-01', 0),
    )

    const breakdown = summary.days.find((day) => day.dayKey === '2026-08-04')
    expect(breakdown?.requiredHoursForDay).toBeCloseTo(8, 4)
    expect(breakdown?.premiumStartHoursForDay).toBeCloseTo(8.7, 4)
  })

  it('recalculates earlier day thresholds when future leave changes remaining workdays', () => {
    const withoutLeave = summarizeMonth(
      '2026-08-01',
      [workRecord('2026-08-04', { endMinute: 18 * 60 })],
      makeSettings(),
      combineDayAndMinutes('2026-08-01', 0),
    )
    const withFutureLeave = summarizeMonth(
      '2026-08-01',
      [
        workRecord('2026-08-04', { endMinute: 18 * 60 }),
        { ...workRecord('2026-08-20'), status: 'annualLeave', startMinute: null, endMinute: null },
      ],
      makeSettings(),
      combineDayAndMinutes('2026-08-01', 0),
    )

    const baseBreakdown = withoutLeave.days.find((day) => day.dayKey === '2026-08-04')
    const updatedBreakdown = withFutureLeave.days.find((day) => day.dayKey === '2026-08-04')
    expect(updatedBreakdown?.premiumStartHoursForDay).toBeGreaterThan(baseBreakdown?.premiumStartHoursForDay ?? 0)
  })

  it('can eliminate premium overtime entirely when the premium-target shortfall is large', () => {
    const summary = summarizeMonth(
      '2026-08-01',
      [workRecord('2026-08-05', { endMinute: 19 * 60 + 30 })],
      makeSettings(),
      combineDayAndMinutes('2026-08-01', 0),
    )

    const breakdown = summary.days.find((day) => day.dayKey === '2026-08-05')
    expect(breakdown?.premiumStartHoursForDay).toBeGreaterThan(9.5)
    expect(breakdown?.premiumOvertimeSeconds).toBe(0)
  })

  it('includes prior weekend work in progress but not in catch-up distribution days', () => {
    const summary = summarizeMonth(
      '2026-08-01',
      [workRecord('2026-08-01', { startMinute: 9 * 60, endMinute: 13 * 60 })],
      makeSettings(),
      combineDayAndMinutes('2026-08-01', 0),
    )

    const breakdown = summary.days.find((day) => day.dayKey === '2026-08-04')
    expect(breakdown?.requiredHoursForDay).toBeCloseTo(8, 4)
    expect(breakdown?.carryOverShortfallHoursForDay).toBeCloseTo(4.7 / 19, 4)
    expect(breakdown?.premiumStartHoursForDay).toBeCloseTo(8 + 14 / 20 + 4.7 / 19, 4)
  })

  it('keeps daily hours at zero when effective workdays are zero', () => {
    const weekdayRecords = datesInMonth('2026-04-01')
      .filter((dayKey) => isWeekday(dayKey) && !isHolidayDay(dayKey))
      .map((dayKey) => ({
        ...workRecord(dayKey),
        status: 'annualLeave' as const,
        startMinute: null,
        endMinute: null,
      }))

    const summary = summarizeMonth('2026-04-01', weekdayRecords, makeSettings(), combineDayAndMinutes('2026-04-01', 0))
    expect(summary.effectiveWorkdays).toBe(0)
    expect(summary.baseDailyRequiredHours).toBe(0)
    expect(summary.baseDailyPremiumStartHours).toBe(0)
  })

  it('tracks recommended hours through today for the current month', () => {
    const summary = summarizeMonth(
      '2026-08-01',
      [],
      makeSettings(),
      combineDayAndMinutes('2026-08-10', 0),
    )

    expect(summary.recommendedWorkdaysElapsed).toBe(6)
    expect(summary.recommendedHoursToDate).toBeCloseTo(48, 4)
  })

  it('uses the full month as the recommended-hours reference for past months', () => {
    const summary = summarizeMonth(
      '2026-07-01',
      [],
      makeSettings(),
      combineDayAndMinutes('2026-08-10', 0),
    )

    expect(summary.recommendedWorkdaysElapsed).toBe(summary.effectiveWorkdays)
    expect(summary.recommendedHoursToDate).toBeCloseTo(summary.requiredHours, 4)
  })

  it('shows zero recommended hours before a future month starts', () => {
    const summary = summarizeMonth(
      '2026-09-01',
      [],
      makeSettings(),
      combineDayAndMinutes('2026-08-10', 0),
    )

    expect(summary.recommendedWorkdaysElapsed).toBe(0)
    expect(summary.recommendedHoursToDate).toBe(0)
  })

  it('reduces early settlement premium as the month progresses and clears it by month end', () => {
    const weekdayKeys = weekdayWorkdayKeys('2026-08-01')
    const records = [
      tenHourNetWorkdayRecord(weekdayKeys[0]),
      ...weekdayKeys.slice(1).map((dayKey) => requiredHoursWorkdayRecord(dayKey)),
    ]

    const earlySummary = summarizeMonth(
      '2026-08-01',
      records,
      makeSettings(),
      combineDayAndMinutes(weekdayKeys[0], 23 * 60),
      'settlement',
    )
    const midSummary = summarizeMonth(
      '2026-08-01',
      records,
      makeSettings(),
      combineDayAndMinutes(weekdayKeys[1], 23 * 60),
      'settlement',
    )
    const finalSummary = summarizeMonth(
      '2026-08-01',
      records,
      makeSettings(),
      combineDayAndMinutes('2026-09-01', 0),
      'settlement',
    )

    expect(earlySummary.totalPremiumOvertimeHours).toBeCloseTo(1.3, 3)
    expect(midSummary.totalPremiumOvertimeHours).toBeCloseTo(0.6, 3)
    expect(finalSummary.totalPremiumOvertimeHours).toBe(0)
    expect(finalSummary.totalPay).toBe(0)
  })

  it('matches the settlement cumulative formula and counts weekend work only in worked totals', () => {
    const summary = summarizeMonth(
      '2026-08-01',
      [
        workRecord('2026-08-01', { endMinute: 13 * 60 }),
        tenHourNetWorkdayRecord('2026-08-03'),
      ],
      makeSettings(),
      combineDayAndMinutes('2026-08-04', 0),
      'settlement',
    )

    const expectedHours = Math.max(
      0,
      summary.totalNetWorkedHours - summary.baseDailyPremiumStartHours * summary.recommendedWorkdaysElapsed,
    )

    expect(summary.recommendedWorkdaysElapsed).toBe(2)
    expect(summary.totalNetWorkedHours).toBeCloseTo(14, 3)
    expect(summary.totalPremiumOvertimeHours).toBeCloseTo(expectedHours, 3)
  })

  it('does not pay hours between required and premium threshold', () => {
    const summary = summarizeMonth(
      '2026-08-01',
      [workRecord('2026-08-03', { endMinute: 18 * 60 + 40 })],
      makeSettings(),
      combineDayAndMinutes('2026-08-01', 0),
    )

    const breakdown = summary.days.find((day) => day.dayKey === '2026-08-03')
    expect(breakdown?.premiumOvertimeSeconds).toBe(0)
    expect(breakdown?.totalPay).toBe(0)
  })

  it('stacks night premium on premium overtime', () => {
    const summary = summarizeMonth(
      '2026-08-01',
      [
        workRecord('2026-08-03', {
          startMinute: 13 * 60,
          endMinute: 23 * 60 + 30,
          nightPremiumEnabled: true,
        }),
      ],
      makeSettings(),
      combineDayAndMinutes('2026-08-01', 0),
    )

    const breakdown = summary.days.find((day) => day.dayKey === '2026-08-03')
    expect(breakdown?.premiumOvertimePay).toBeCloseTo(120, 3)
    expect(breakdown?.nightPremiumPay).toBeCloseTo(40, 3)
    expect(breakdown?.totalPay).toBeCloseTo(160, 3)
    expect(summary.totalNightPremiumHours).toBeCloseTo(0.8, 3)
  })

  it('preserves settlement night premium even when later daytime premium absorbs the remaining total', () => {
    const summary = summarizeMonth(
      '2026-08-01',
      [
        workRecord('2026-08-03', {
          startMinute: 13 * 60,
          endMinute: 23 * 60 + 30,
          nightPremiumEnabled: true,
        }),
        tenHourNetWorkdayRecord('2026-08-04'),
      ],
      makeSettings(),
      combineDayAndMinutes('2026-08-04', 23 * 60),
      'settlement',
    )

    const firstDay = summary.days.find((day) => day.dayKey === '2026-08-03')
    const secondDay = summary.days.find((day) => day.dayKey === '2026-08-04')

    expect(summary.totalPremiumOvertimeHours).toBeCloseTo(2.1, 3)
    expect(summary.totalNightPremiumHours).toBeCloseTo(1.5, 3)
    expect(firstDay?.nightPremiumSeconds).toBeCloseTo(1.5 * 3_600, 3)
    expect(firstDay?.premiumOvertimeSeconds).toBeCloseTo(1.5 * 3_600, 3)
    expect(secondDay?.premiumOvertimeSeconds).toBeCloseTo(0.6 * 3_600, 3)
  })

  it('marks future-month settlement days as outside the premium reference', () => {
    const summary = summarizeMonth(
      '2026-09-01',
      [tenHourNetWorkdayRecord('2026-09-01')],
      makeSettings(),
      combineDayAndMinutes('2026-08-10', 0),
      'settlement',
    )

    expect(summary.totalPremiumOvertimeHours).toBe(0)
    expect(summary.totalNightPremiumHours).toBe(0)
    expect(summary.premiumReferenceDayKey).toBeNull()
    expect(summary.days.every((day) => day.isWithinPremiumReference === false)).toBe(true)
  })

  it('matches automatic break thresholds', () => {
    const settings = makeSettings()
    expect(
      breakdownForDay('2026-08-06', workRecord('2026-08-06', { endMinute: 13 * 60 }), settings, 24, 24, combineDayAndMinutes('2026-08-06', 0))
        .autoBreakMinutes,
    ).toBe(0)
    expect(
      breakdownForDay('2026-08-06', workRecord('2026-08-06', { endMinute: 13 * 60 + 1 }), settings, 24, 24, combineDayAndMinutes('2026-08-06', 0))
        .autoBreakMinutes,
    ).toBe(30)
    expect(
      breakdownForDay('2026-08-06', workRecord('2026-08-06', { endMinute: 17 * 60 + 30 }), settings, 24, 24, combineDayAndMinutes('2026-08-06', 0))
        .autoBreakMinutes,
    ).toBe(30)
    expect(
      breakdownForDay('2026-08-06', workRecord('2026-08-06', { endMinute: 17 * 60 + 31 }), settings, 24, 24, combineDayAndMinutes('2026-08-06', 0))
        .autoBreakMinutes,
    ).toBe(60)
  })

  it('keeps manual lunch override over automatic recommendation', () => {
    const breakdown = breakdownForDay(
      '2026-08-06',
      workRecord('2026-08-06', { endMinute: 18 * 60 + 30, lunchBreakOverrideMinutes: 30 }),
      makeSettings(),
      24,
      24,
      combineDayAndMinutes('2026-08-06', 0),
    )

    expect(breakdown.autoBreakMinutes).toBe(30)
    expect(breakdown.lunchBreakIsAutomatic).toBe(false)
  })

  it('continues running shifts across midnight', () => {
    const nowTimestamp = combineDayAndMinutes('2026-04-07', 30)
    const breakdown = breakdownForDay(
      '2026-04-06',
      workRecord('2026-04-06', { startMinute: 23 * 60, endMinute: null, isRunning: true }),
      makeSettings(),
      24,
      24,
      nowTimestamp,
    )

    expect(breakdown.isLive).toBe(true)
    expect(breakdown.grossWorkedSeconds).toBeCloseTo(1.5 * 3_600, 3)
    expect(breakdown.netWorkedSeconds).toBeCloseTo(1.5 * 3_600, 3)
  })

  it('turns on monthly cap warning when work exceeds limit', () => {
    const records = [
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-31',
    ].map((dayKey) => workRecord(dayKey, { startMinute: 8 * 60, endMinute: 23 * 60 }))

    const summary = summarizeMonth('2026-08-01', records, makeSettings(), combineDayAndMinutes('2026-08-01', 0))
    expect(summary.exceedsMonthlyCap).toBe(true)
    expect(summary.totalNetWorkedHours).toBeGreaterThan(summary.maxAllowedHours)
  })

  it('subtracts business trip from required hours and workdays', () => {
    const summary = summarizeMonth(
      '2026-04-01',
      [{ ...workRecord('2026-04-09'), status: 'businessTrip', startMinute: null, endMinute: null }],
      makeSettings(),
      combineDayAndMinutes('2026-04-01', 0),
    )

    expect(summary.businessTripDays).toBe(1)
    expect(summary.effectiveWorkdays).toBe(21)
    expect(summary.requiredHours).toBe(163)
  })

  it('uses actual overtime boundary when shift is complete', () => {
    const summary = summarizeMonth(
      '2026-08-01',
      [workRecord('2026-08-03', { endMinute: 19 * 60 + 30 })],
      makeSettings(),
      combineDayAndMinutes('2026-08-01', 0),
    )

    const breakdown = summary.days.find((day) => day.dayKey === '2026-08-03')
    expect(breakdown?.premiumStartTimestamp).not.toBeNull()
    expect(minutesOfDay(breakdown?.premiumStartTimestamp ?? 0)).toBe(18 * 60 + 42)
  })

  it('estimates premium start during a running shift', () => {
    const records = [
      workRecord('2026-04-01', { startMinute: 7 * 60 + 33, endMinute: null, isRunning: true }),
      { ...workRecord('2026-04-20'), status: 'annualLeave' as const, startMinute: null, endMinute: null },
      { ...workRecord('2026-04-27'), status: 'businessTrip' as const, startMinute: null, endMinute: null },
      { ...workRecord('2026-04-28'), status: 'businessTrip' as const, startMinute: null, endMinute: null },
      { ...workRecord('2026-04-29'), status: 'businessTrip' as const, startMinute: null, endMinute: null },
      { ...workRecord('2026-04-30'), status: 'businessTrip' as const, startMinute: null, endMinute: null },
    ]

    const summary = summarizeMonth(
      '2026-04-01',
      records,
      createDefaultAppSettings(24_584),
      combineDayAndMinutes('2026-04-01', 12 * 60 + 31),
    )

    const breakdown = summary.days.find((day) => day.dayKey === '2026-04-01')
    expect(minutesOfDay(breakdown?.premiumStartTimestamp ?? 0)).toBe(17 * 60 + 4)
  })
})

function minutesOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

function requiredHoursWorkdayRecord(dayKey: string): DayRecord {
  return workRecord(dayKey, { startMinute: 9 * 60, endMinute: 18 * 60 })
}

function tenHourNetWorkdayRecord(dayKey: string): DayRecord {
  return workRecord(dayKey, { startMinute: 9 * 60, endMinute: 20 * 60 })
}

function weekdayWorkdayKeys(monthDayKey: string): string[] {
  return datesInMonth(monthDayKey).filter((dayKey) => isWeekday(dayKey) && !isHolidayDay(dayKey))
}
