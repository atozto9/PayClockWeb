import { useRef, useState, type ReactNode } from 'react'
import './App.css'
import {
  clockText,
  currency,
  dayLabel,
  dayNumber,
  durationText,
  hours,
  hoursFromSeconds,
  monthLabel,
  premiumStartText,
  wholeHours,
} from './app/formatters'
import { useInstallPrompt } from './app/useInstallPrompt'
import { useAppModel } from './app/useAppModel'
import { automaticLunchBreakMinutes } from './domain/payCalculator'
import { dayStatusDisplayName, type DayPayBreakdown, type DayRecord } from './domain/models'
import {
  combineDayAndMinutes,
  datesInMonth,
  firstWeekdayOffset,
  weekdayIndex,
} from './domain/payclockCalendar'

const weekdaySymbols = ['일', '월', '화', '수', '목', '금', '토']
const quickExcludedValues = [0, 30, 60, 90]

function App() {
  const model = useAppModel()
  const installPrompt = useInstallPrompt()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(false)
  const dates = datesInMonth(model.selectedMonth)
  const selectedRecord = model.recordFor(model.selectedDate)
  const selectedBreakdown = model.dayMap.get(model.selectedDate) ?? emptyBreakdown(model.selectedDate, selectedRecord.status)
  const selectedStatusLabel = dayStatusDisplayName[selectedRecord.status]

  function patchSelectedRecord(patch: Partial<DayRecord>) {
    model.updateRecord({
      ...selectedRecord,
      ...patch,
    })
  }

  function openImportPicker() {
    importInputRef.current?.click()
  }

  function handleImportChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    void model.importFile(file)
  }

  return (
    <div className="app-shell">
      <div className="background-grid" aria-hidden="true" />
      <header className="hero-panel">
        <div className="hero-copy">
          <div className="hero-meta-row" aria-label="핵심 특징">
            <span className="meta-pill meta-pill--accent">Local-first</span>
            <span className="meta-pill">KST calendar</span>
            <span className="meta-pill">JSON / CSV</span>
          </div>
          <h1>PayClock</h1>
          <p className="hero-description">
            월별 근무 기록과 추가수당 계산을 한 화면에서 정리합니다. 데이터는 이 브라우저에만 저장됩니다.
          </p>
          <div className="hero-highlights">
            <article className="hero-highlight">
              <span>This month</span>
              <strong>{currency(model.monthSummary.totalPay)}</strong>
              <p>{hours(model.monthSummary.totalPremiumOvertimeHours)} 1.5배 대상</p>
            </article>
            <article className="hero-highlight">
              <span>Required</span>
              <strong>{wholeHours(model.monthSummary.requiredHours)}</strong>
              <p>{requiredHoursSubtitle(model.monthSummary)}</p>
            </article>
            <article className="hero-highlight">
              <span>Storage</span>
              <strong>Local only</strong>
              <p>JSON / CSV 백업</p>
            </article>
          </div>
          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={openImportPicker}>
              데이터 불러오기
            </button>
            {installPrompt.canInstall ? (
              <button type="button" className="ghost-button ghost-button--install" onClick={() => void installPrompt.installApp()}>
                앱 설치
              </button>
            ) : null}
            <button type="button" className="ghost-button" onClick={model.goToToday}>
              오늘로 이동
            </button>
          </div>
        </div>

        <section className="live-card" aria-label="실시간 추가 금액">
          <div className="live-card__header">
            <div>
              <p className="live-card__label">Live tally</p>
              <strong className="live-card__value" data-testid="live-pay">
                {currency(model.liveBreakdown.totalPay)}
              </strong>
            </div>
            <span className={`live-card__badge ${model.liveBreakdown.isLive ? 'is-live' : ''}`}>
              {model.liveBreakdown.isLive ? 'Tracking now' : 'Today snapshot'}
            </span>
          </div>
          <p className="live-card__subtext">
            {model.liveBreakdown.isLive
              ? '실시간 진행 중인 근무를 반영해 추가 금액을 계속 갱신합니다.'
              : '오늘 기준 추가 금액을 빠르게 확인할 수 있습니다.'}
          </p>
          <p className="live-card__context">
            {dayLabel(model.selectedDate)} · {selectedRecord.isRunning ? '실시간 진행 중' : selectedStatusLabel}
          </p>
          <div className="live-card__stats">
            <article className="live-card__stat">
              <span>This month</span>
              <strong>{currency(model.monthSummary.totalPay)}</strong>
            </article>
            <article className="live-card__stat">
              <span>Selected pay</span>
              <strong>{currency(selectedBreakdown.totalPay)}</strong>
            </article>
            <article className="live-card__stat">
              <span>Premium line</span>
              <strong>{hours(model.liveBreakdown.premiumStartHoursForDay)}</strong>
            </article>
          </div>
        </section>
      </header>

      {model.errorMessage ? (
        <aside className="notice-banner" role="status">
          <span>{model.errorMessage}</span>
          <button type="button" className="chip-button" onClick={model.clearError}>
            닫기
          </button>
        </aside>
      ) : null}

      <main className="layout-grid">
        <section className="surface summary-grid" aria-label="이번 달 요약">
          <SectionHeader title="이번 달 요약" subtitle={monthLabel(model.selectedMonth)} />
          <div className="summary-grid__cards">
            <SummaryCard
              title="총 추가 금액"
              value={currency(model.monthSummary.totalPay)}
              subtitle={`1.5배 대상 ${hours(model.monthSummary.totalPremiumOvertimeHours)}`}
            />
            <SummaryCard
              title="월 필수 근무"
              value={wholeHours(model.monthSummary.requiredHours)}
              subtitle={requiredHoursSubtitle(model.monthSummary)}
            />
            <SummaryCard
              title="남은 가능 시간"
              value={hours(Math.max(0, model.monthSummary.maxAllowedHours - model.monthSummary.totalNetWorkedHours))}
              subtitle={
                model.monthSummary.exceedsMonthlyCap
                  ? `상한 초과 ${hours(model.monthSummary.totalNetWorkedHours - model.monthSummary.maxAllowedHours)}`
                  : `월 상한 ${wholeHours(model.monthSummary.maxAllowedHours)}`
              }
            />
            <SummaryCard
              title="1.5배 시작선"
              value={hours(selectedBreakdown.premiumStartHoursForDay)}
              subtitle={premiumStartSummarySubtitle(selectedBreakdown, model.monthSummary)}
            />
            <SummaryCard
              title="총 실근무"
              value={hours(model.monthSummary.totalNetWorkedHours)}
              subtitle="월 누적 실근무"
            />
          </div>
          {model.monthSummary.exceedsMonthlyCap ? (
            <p className="warning-text">월 최대 근무 가능 시간을 넘겼습니다. 입력은 유지되지만 확인이 필요합니다.</p>
          ) : null}
        </section>

        <section className="surface calendar-surface">
          <div className="calendar-header">
            <SectionHeader title="달력" subtitle={`${monthLabel(model.selectedMonth)} · 한국 시간 기준`} />
            <div className="month-controls">
              <button type="button" className="chip-button" onClick={() => model.moveMonth(-1)}>
                이전 달
              </button>
              <button type="button" className="chip-button" onClick={model.goToToday}>
                오늘
              </button>
              <button type="button" className="chip-button" onClick={() => model.moveMonth(1)}>
                다음 달
              </button>
            </div>
          </div>

          <div className="weekday-row" aria-hidden="true">
            {weekdaySymbols.map((symbol, index) => (
              <span key={symbol} className={`weekday weekday--${weekdayTone(index)}`}>
                {symbol}
              </span>
            ))}
          </div>

          <div className="calendar-grid">
            {Array.from({ length: firstWeekdayOffset(model.selectedMonth) }).map((_, index) => (
              <span key={`blank-${index}`} className="calendar-blank" />
            ))}

            {dates.map((dayKey) => {
              const breakdown = model.dayMap.get(dayKey) ?? emptyBreakdown(dayKey, model.recordFor(dayKey).status)
              const record = model.recordFor(dayKey)
              const isSelected = dayKey === model.selectedDate

              return (
                <button
                  key={dayKey}
                  type="button"
                  className={`calendar-cell calendar-cell--${breakdown.status} ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => model.selectDate(dayKey)}
                  data-testid={`day-cell-${dayKey}`}
                >
                  <span className="calendar-cell__top">
                    <span className={`calendar-cell__day calendar-cell__day--${weekdayTone(weekdayIndex(dayKey))}`}>
                      {dayNumber(dayKey)}
                    </span>
                    {record.isRunning ? <span className="live-dot" aria-label="실시간 진행 중" /> : null}
                  </span>
                  <span className="calendar-cell__caption">{captionForBreakdown(breakdown)}</span>
                  <strong className="calendar-cell__pay">{currency(breakdown.totalPay)}</strong>
                </button>
              )
            })}
          </div>
        </section>

        <section className="surface settings-surface">
          <SectionHeader
            title="설정"
            subtitle={isSettingsExpanded ? '민감한 값은 필요할 때만 열어 확인합니다' : ''}
            action={
              <button
                type="button"
                className="chip-button"
                aria-expanded={isSettingsExpanded}
                aria-controls="settings-content"
                onClick={() => setIsSettingsExpanded((current) => !current)}
              >
                {isSettingsExpanded ? '설정 숨기기' : '설정 보기'}
              </button>
            }
          />
          {isSettingsExpanded ? (
            <div id="settings-content">
              <div className="field-grid">
                <label className="field">
                  <span>시급</span>
                  <input
                    type="number"
                    min={0}
                    aria-label="시급"
                    value={model.data.settings.hourlyRate}
                    onChange={(event) => model.setHourlyRate(Number(event.target.value || 0))}
                  />
                </label>

                <label className="field">
                  <span>1.5배 기준 추가 시간</span>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    aria-label="1.5배 기준 추가 시간"
                    value={model.data.settings.premiumThresholdHours}
                    onChange={(event) => model.setPremiumThresholdHours(Number(event.target.value || 0))}
                  />
                </label>
              </div>

              <div className="field-grid">
                <label className="field">
                  <span>실시간 갱신 주기(초)</span>
                  <input
                    type="number"
                    min={1}
                    aria-label="실시간 갱신 주기"
                    value={model.data.settings.refreshIntervalSeconds}
                    onChange={(event) => model.setRefreshIntervalSeconds(Number(event.target.value || 1))}
                  />
                </label>
              </div>
            </div>
          ) : null}
        </section>

        <section className="surface editor-surface">
          <SectionHeader title="선택한 날짜" subtitle={dayLabel(model.selectedDate)} />
          <div className="metrics-row">
            <MetricCard title="추가 금액" value={currency(selectedBreakdown.totalPay)} />
            <MetricCard title="실근무" value={hoursFromSeconds(selectedBreakdown.netWorkedSeconds)} />
            <MetricCard title="심야 가산" value={hoursFromSeconds(selectedBreakdown.nightPremiumSeconds)} />
            <MetricCard
              title={selectedBreakdown.lunchBreakIsAutomatic ? '점심시간(자동)' : '점심시간'}
              value={`${selectedBreakdown.autoBreakMinutes}분`}
            />
          </div>

          <div className="field-grid">
            <label className="field">
              <span>상태</span>
              <select
                value={selectedRecord.status}
                onChange={(event) => patchSelectedRecord({ status: event.target.value as DayRecord['status'] })}
              >
                {Object.entries(dayStatusDisplayName).map(([status, label]) => (
                  <option key={status} value={status}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>메모</span>
              <input
                type="text"
                value={selectedRecord.note}
                onChange={(event) => patchSelectedRecord({ note: event.target.value })}
                placeholder="간단한 메모"
              />
            </label>
          </div>

          {selectedRecord.status === 'work' ? (
            <>
              <div className="field-grid">
                <label className="field">
                  <span>근무 시작</span>
                  <input
                    type="time"
                    aria-label="근무 시작"
                    value={clockText(selectedRecord.startMinute)}
                    onChange={(event) => patchSelectedRecord({ startMinute: parseTimeInput(event.target.value) })}
                  />
                </label>

                <label className="field">
                  <span>근무 종료</span>
                  <input
                    type="time"
                    aria-label="근무 종료"
                    value={selectedRecord.isRunning ? '' : clockText(selectedRecord.endMinute)}
                    onChange={(event) => patchSelectedRecord({ endMinute: parseTimeInput(event.target.value) })}
                    disabled={selectedRecord.isRunning}
                  />
                  {selectedRecord.isRunning ? <small>실시간 진행 중</small> : null}
                </label>
              </div>

              <div className="toggle-grid">
                <label className="toggle-field">
                  <span>다음날 종료</span>
                  <input
                    type="checkbox"
                    checked={selectedRecord.endsNextDay}
                    onChange={(event) => patchSelectedRecord({ endsNextDay: event.target.checked })}
                    disabled={selectedRecord.endMinute === null || selectedRecord.isRunning}
                  />
                </label>

                <label className="toggle-field">
                  <span>실시간 진행</span>
                  <input
                    type="checkbox"
                    checked={selectedRecord.isRunning}
                    onChange={(event) => patchSelectedRecord({ isRunning: event.target.checked })}
                    disabled={!model.isSelectedDateToday && !selectedRecord.isRunning}
                  />
                </label>

                <label className="toggle-field">
                  <span>22시 이후 가산</span>
                  <input
                    type="checkbox"
                    checked={selectedRecord.nightPremiumEnabled}
                    onChange={(event) => patchSelectedRecord({ nightPremiumEnabled: event.target.checked })}
                  />
                </label>
              </div>

              <section className="inline-surface">
                <div className="inline-surface__header">
                  <strong>점심시간</strong>
                  <span>
                    {selectedRecord.lunchBreakOverrideMinutes === null
                      ? `자동 추천 ${durationText(recommendedLunchBreakMinutes(selectedRecord, model.nowTimestamp))}`
                      : `직접 설정 ${durationText(selectedRecord.lunchBreakOverrideMinutes)}`}
                  </span>
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    className={`chip-button ${selectedRecord.lunchBreakOverrideMinutes === null ? 'is-active' : ''}`}
                    onClick={() => patchSelectedRecord({ lunchBreakOverrideMinutes: null })}
                  >
                    자동
                  </button>
                  <button
                    type="button"
                    className={`chip-button ${selectedRecord.lunchBreakOverrideMinutes === 0 ? 'is-active' : ''}`}
                    onClick={() => patchSelectedRecord({ lunchBreakOverrideMinutes: 0 })}
                  >
                    0분
                  </button>
                  <button
                    type="button"
                    className={`chip-button ${selectedRecord.lunchBreakOverrideMinutes === 30 ? 'is-active' : ''}`}
                    onClick={() => patchSelectedRecord({ lunchBreakOverrideMinutes: 30 })}
                  >
                    30분
                  </button>
                  <button
                    type="button"
                    className={`chip-button ${selectedRecord.lunchBreakOverrideMinutes === 60 ? 'is-active' : ''}`}
                    onClick={() => patchSelectedRecord({ lunchBreakOverrideMinutes: 60 })}
                  >
                    1시간
                  </button>
                </div>
              </section>

              <section className="inline-surface">
                <div className="inline-surface__header">
                  <strong>기타 제외시간</strong>
                  <span>합계 {durationText(selectedRecord.extraExcludedMinutes)}</span>
                </div>

                <div className="button-row">
                  {quickExcludedValues.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      className={`chip-button ${selectedRecord.extraExcludedMinutes === minutes ? 'is-active' : ''}`}
                      onClick={() => patchSelectedRecord({ extraExcludedMinutes: minutes })}
                    >
                      {durationText(minutes)}
                    </button>
                  ))}
                </div>

                <div className="field-grid">
                  <label className="field">
                    <span>시간</span>
                    <input
                      type="number"
                      min={0}
                      value={Math.floor(selectedRecord.extraExcludedMinutes / 60)}
                      onChange={(event) =>
                        patchSelectedRecord({
                          extraExcludedMinutes:
                            Math.max(0, Number(event.target.value || 0)) * 60 + (selectedRecord.extraExcludedMinutes % 60),
                        })
                      }
                    />
                  </label>

                  <label className="field">
                    <span>분</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={selectedRecord.extraExcludedMinutes % 60}
                      onChange={(event) =>
                        patchSelectedRecord({
                          extraExcludedMinutes:
                            Math.floor(selectedRecord.extraExcludedMinutes / 60) * 60 +
                            Math.max(0, Math.min(59, Number(event.target.value || 0))),
                        })
                      }
                    />
                  </label>
                </div>
              </section>

              <section className="inline-surface inline-surface--highlight">
                <div className="inline-surface__header">
                  <strong>추가수당 시작</strong>
                  <span>
                    {selectedRecord.startMinute === null
                      ? '시작시간 입력 필요'
                      : selectedBreakdown.premiumStartTimestamp === null
                        ? '계산 불가'
                        : premiumStartText(selectedBreakdown.premiumStartTimestamp, model.selectedDate)}
                  </span>
                </div>
                <p className="hint-text">
                  점심시간과 기타 제외시간은 앞쪽 근무 구간에서 먼저 차감합니다. 실시간 진행 중이면 지급 시작 시각을 계속 다시 계산합니다.
                </p>
              </section>
            </>
          ) : (
            <p className="hint-text">근무 외 상태는 시간 입력 없이 월 필수 근무시간과 일별 기준선에만 반영됩니다.</p>
          )}

          <div className="editor-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                if (window.confirm('선택한 날짜의 기록을 삭제합니다.')) {
                  model.resetDate(model.selectedDate)
                }
              }}
            >
              기록 초기화
            </button>
          </div>
        </section>

        <section className="surface data-surface">
          <SectionHeader title="데이터" subtitle="브라우저 로컬 저장소에만 저장됩니다" />
          <div className="button-row">
            <button type="button" className="primary-button" onClick={model.exportJSON}>
              JSON 내보내기
            </button>
            <button type="button" className="ghost-button" onClick={model.exportCSV}>
              CSV 내보내기
            </button>
            <button type="button" className="ghost-button" onClick={openImportPicker}>
              불러오기
            </button>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,.csv"
            onChange={handleImportChange}
            className="sr-only"
          />
          <p className="hint-text">
            JSON 불러오기는 현재 데이터를 덮어쓰고, CSV 불러오기는 같은 날짜일 때 가져온 값이 우선합니다.
          </p>
        </section>
      </main>

      {model.pendingJSONImport ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="json-import-title">
            <h2 id="json-import-title">JSON 불러오기</h2>
            <p>JSON 불러오기는 현재 데이터를 모두 덮어씁니다.</p>
            <div className="button-row button-row--end">
              <button type="button" className="ghost-button" onClick={model.discardPendingJSONImport}>
                취소
              </button>
              <button type="button" className="primary-button" onClick={model.confirmPendingJSONImport}>
                현재 데이터 덮어쓰기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SectionHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="section-header">
      <div className="section-header__text">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action ? <div className="section-header__actions">{action}</div> : null}
    </div>
  )
}

function SummaryCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <article className="summary-card">
      <p className="summary-card__title">{title}</p>
      <strong className="summary-card__value">{value}</strong>
      <span className="summary-card__subtitle">{subtitle}</span>
    </article>
  )
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <article className="metric-card">
      <p className="metric-card__title">{title}</p>
      <strong className="metric-card__value">{value}</strong>
    </article>
  )
}

function requiredHoursSubtitle(summary: ReturnType<typeof useAppModel>['monthSummary']) {
  const parts = [
    `근무일 ${summary.defaultWorkdays}일`,
    `연차 ${summary.annualLeaveDays}일`,
    `출장 ${summary.businessTripDays}일`,
  ]

  if (summary.manualHolidayDays > 0) {
    parts.push(`수동 공휴일 ${summary.manualHolidayDays}일`)
  }

  if (summary.offDays > 0) {
    parts.push(`휴무 ${summary.offDays}일`)
  }

  return parts.join(' · ')
}

function premiumStartSummarySubtitle(
  breakdown: DayPayBreakdown,
  summary: ReturnType<typeof useAppModel>['monthSummary'],
): string {
  const catchUpHours = Math.max(0, breakdown.requiredHoursForDay - summary.baseDailyRequiredHours)
  const premiumShareHours = Math.max(0, breakdown.premiumStartHoursForDay - breakdown.requiredHoursForDay)

  return `선택일 기준 · 기본 ${hours(summary.baseDailyRequiredHours)} + 부족분 ${hours(catchUpHours)} + 분배 ${hours(premiumShareHours)}`
}

function captionForBreakdown(breakdown: DayPayBreakdown): string {
  switch (breakdown.status) {
    case 'work':
      if (breakdown.isLive) {
        return '실시간 계산'
      }
      if (breakdown.netWorkedSeconds > 0) {
        return hoursFromSeconds(breakdown.netWorkedSeconds)
      }
      return '근무일'
    case 'annualLeave':
      return '연차'
    case 'businessTrip':
      return '출장'
    case 'holiday':
      return breakdown.holidayName ?? '공휴일'
    case 'off':
      return '휴무'
  }
}

function weekdayTone(index: number): 'sun' | 'sat' | 'workday' {
  if (index === 0) {
    return 'sun'
  }
  if (index === 6) {
    return 'sat'
  }
  return 'workday'
}

function parseTimeInput(value: string): number | null {
  if (!value) {
    return null
  }

  const [hourText, minuteText] = value.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null
  }

  return hour * 60 + minute
}

function recommendedLunchBreakMinutes(record: DayRecord, nowTimestamp: number): number {
  if (record.startMinute === null) {
    return 0
  }

  const shiftStartTimestamp = combineDayAndMinutes(record.dayKey, record.startMinute)
  let shiftEndTimestamp: number | null = null

  if (record.isRunning) {
    shiftEndTimestamp = Math.max(nowTimestamp, shiftStartTimestamp)
  } else if (record.endMinute !== null) {
    shiftEndTimestamp = combineDayAndMinutes(record.dayKey, record.endMinute, record.endsNextDay)
  }

  if (shiftEndTimestamp === null || shiftEndTimestamp <= shiftStartTimestamp) {
    return 0
  }

  return automaticLunchBreakMinutes((shiftEndTimestamp - shiftStartTimestamp) / 1_000)
}

function emptyBreakdown(dayKey: string, status: DayPayBreakdown['status']): DayPayBreakdown {
  return {
    dayKey,
    status,
    holidayName: null,
    requiredHoursForDay: 0,
    premiumStartHoursForDay: 0,
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

export default App
