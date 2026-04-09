import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
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
import { useAppBadge } from './app/useAppBadge'
import { useInstallPrompt } from './app/useInstallPrompt'
import { useLaunchQueueImport } from './app/useLaunchQueueImport'
import { useWakeLock } from './app/useWakeLock'
import { useAppModel } from './app/useAppModel'
import { automaticLunchBreakMinutes } from './domain/payCalculator'
import { dayStatusDisplayName, type DayPayBreakdown, type DayRecord, type DayStatus, type PremiumCalculationMode } from './domain/models'
import {
  combineDayAndMinutes,
  datesInMonth,
  firstWeekdayOffset,
  weekdayIndex,
} from './domain/payclockCalendar'

const weekdaySymbols = ['일', '월', '화', '수', '목', '금', '토']
const quickExcludedValues = [0, 30, 60, 90]
const todayStatusActions: DayStatus[] = ['annualLeave', 'businessTrip', 'off']

function App() {
  const model = useAppModel()
  const installPrompt = useInstallPrompt()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const dataSectionRef = useRef<HTMLElement | null>(null)
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(false)
  const isSingleColumnLayout = useMediaQuery('(max-width: 980px)')
  const dates = datesInMonth(model.selectedMonth)
  const selectedRecord = model.recordFor(model.selectedDate)
  const displaySelectedBreakdown = model.displayDayMap.get(model.selectedDate) ?? emptyBreakdown(model.selectedDate, selectedRecord.status)
  const selectedStatusLabel = dayStatusDisplayName[selectedRecord.status]
  const todayConsoleBreakdown = model.liveBreakdown
  const todayConsoleRecord = model.recordFor(todayConsoleBreakdown.dayKey)
  const todayMonthSummary = model.summaryForDate(todayConsoleBreakdown.dayKey)
  const todayProjectedBreakdown = model.projectedBreakdownForRunningDay(todayConsoleBreakdown.dayKey, 30)
  const todayConsoleTimeline = timelineForRecord(todayConsoleRecord, todayConsoleBreakdown, model.nowTimestamp)
  const todayConsoleSummary = premiumProgressSummary(todayConsoleRecord, todayConsoleBreakdown, model.nowTimestamp)
  const todayConsoleTitle = model.activeRunningDayKey && model.activeRunningDayKey !== model.todayKey ? '진행 중 근무' : '오늘 근무'

  useWakeLock(model.activeRunningDayKey !== null)
  useAppBadge(model.activeRunningDayKey !== null)
  useLaunchQueueImport(model.importFile)

  function openImportPicker() {
    importInputRef.current?.click()
  }

  const handleLaunchAction = useEffectEvent((action: string) => {
    switch (action) {
      case 'today':
        model.goToToday()
        return
      case 'start':
        model.goToToday()
        model.startTodayWork()
        return
      case 'stop':
        model.stopActiveWork()
        return
      case 'import':
        dataSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        window.setTimeout(() => {
          openImportPicker()
        }, 60)
        return
      case 'export-json':
        model.exportJSON()
        return
      case 'export-csv':
        model.exportCSV()
        return
    }
  })

  useEffect(() => {
    const currentUrl = new URL(window.location.href)
    const action = currentUrl.searchParams.get('action')
    if (!action) {
      return
    }

    handleLaunchAction(action)
    currentUrl.searchParams.delete('action')
    window.history.replaceState({}, '', currentUrl)
  }, [])

  function patchSelectedRecord(patch: Partial<DayRecord>) {
    model.updateRecord({
      ...selectedRecord,
      ...patch,
    })
  }

  function handleImportChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    void model.importFile(file)
  }

  function handleTodayStart() {
    model.goToToday()
    model.startTodayWork()
  }

  function handleTodayStop() {
    model.stopActiveWork()
  }

  function handleTodayStatus(status: DayStatus) {
    model.goToToday()
    model.setTodayStatus(status)
  }

  const todayConsoleSection = (
    <section className={`today-console ${isSingleColumnLayout ? 'today-console--standalone' : ''}`} aria-label="오늘 근무 콘솔">
      <div className="today-console__header">
        <div>
          <p className="section-kicker">{todayConsoleTitle}</p>
          <h2 className="today-console__value" data-testid="live-pay">
            {currency(todayConsoleBreakdown.totalPay)}
          </h2>
          <p className="today-console__context">
            {dayLabel(todayConsoleBreakdown.dayKey)} · {todayConsoleRecord.isRunning ? '실시간 진행 중' : dayStatusDisplayName[todayConsoleRecord.status]}
          </p>
        </div>
        <span className={`status-pill ${todayConsoleRecord.isRunning ? 'is-live' : ''}`}>
          {todayConsoleRecord.isRunning ? 'Tracking now' : 'Today console'}
        </span>
      </div>

      <p className="today-console__message">{todayConsoleSummary.description}</p>

      <div className="today-console__stats">
        <TodayStat title="이번 달 누적" value={currency(todayMonthSummary.totalPay)} />
        <TodayStat title="추가수당 시작" value={todayConsoleSummary.value} />
        <TodayStat
          title="30분 더 근무"
          value={projectedExtensionValue(todayProjectedBreakdown, todayConsoleBreakdown, todayConsoleRecord)}
        />
        <TodayStat title="현재 실근무" value={hoursFromSeconds(todayConsoleBreakdown.netWorkedSeconds)} />
      </div>

      <div className="today-console__actions">
        <button
          type="button"
          className="primary-button quick-action-button"
          onClick={handleTodayStart}
          disabled={model.activeRunningDayKey !== null}
        >
          출근 시작
        </button>
        <button
          type="button"
          className="ghost-button quick-action-button"
          onClick={handleTodayStop}
          disabled={model.activeRunningDayKey === null}
        >
          근무 종료
        </button>
        {todayStatusActions.map((status) => (
          <button
            key={status}
            type="button"
            className={`chip-button quick-chip ${model.todayKey === model.selectedDate && selectedRecord.status === status ? 'is-active' : ''}`}
            onClick={() => handleTodayStatus(status)}
            disabled={model.activeRunningDayKey !== null}
          >
            {dayStatusDisplayName[status]}
          </button>
        ))}
        <button type="button" className="ghost-button quick-action-button" onClick={() => model.resetDate(model.todayKey)}>
          오늘 기록 초기화
        </button>
      </div>

      <section className="timeline-card">
        <div className="timeline-card__header">
          <strong>오늘 추가수당 흐름</strong>
          <span>{todayConsoleSummary.secondary}</span>
        </div>
        {todayConsoleTimeline ? (
          <TodayTimeline timeline={todayConsoleTimeline} />
        ) : (
          <p className="hint-text">
            근무 시작 후 `추가수당 시작`, `22시 이후 가산`, `점심/기타 제외 선차감` 흐름을 시각적으로 보여줍니다.
          </p>
        )}
      </section>
    </section>
  )

  return (
    <div className="app-shell">
      <div className="background-grid" aria-hidden="true" />

      <header className="surface masthead">
        <div className="masthead__copy">
          <div className="hero-meta-row" aria-label="핵심 특징">
            <span className="meta-pill meta-pill--accent">Overtime-first</span>
            <span className="meta-pill">Desktop PWA</span>
            <span className="meta-pill">Local-first</span>
          </div>
          <h1>PayClock</h1>
          <p className="hero-description">
            추가수당 흐름과 오늘 근무 상태를 한 화면에서 관리합니다. 데이터는 이 브라우저와 설치형 앱 안에만 저장됩니다.
          </p>
        </div>
        <div className="masthead__actions">
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
      </header>

      {model.errorMessage ? (
        <aside className="notice-banner" role="status">
          <span>{model.errorMessage}</span>
          <button type="button" className="chip-button" onClick={model.clearError}>
            닫기
          </button>
        </aside>
      ) : null}

      {isSingleColumnLayout ? todayConsoleSection : null}

      <main className="dashboard-grid">
        {isSingleColumnLayout ? null : todayConsoleSection}

        <section className="surface summary-grid" aria-label="이번 달 요약">
          <SectionHeader
            title="이번 달 요약"
            subtitle={monthLabel(model.selectedMonth)}
            action={
              <PremiumModeControl
                value={model.premiumCalculationMode}
                onChange={model.setPremiumCalculationMode}
              />
            }
          />
          <div className="summary-grid__cards">
            <SummaryCard
              title="총 추가 금액"
              value={currency(model.displayMonthSummary.totalPay)}
              subtitle={`1.5배 대상 ${hours(model.displayMonthSummary.totalPremiumOvertimeHours)} · 심야 가산 ${hours(model.displayMonthSummary.totalNightPremiumHours)}`}
            />
            <SummaryCard
              title="월 필수 근무"
              value={wholeHours(model.displayMonthSummary.requiredHours)}
              subtitle={requiredHoursSubtitle(model.displayMonthSummary)}
            />
            <SummaryCard
              title="남은 가능 시간"
              value={hours(Math.max(0, model.displayMonthSummary.maxAllowedHours - model.displayMonthSummary.totalNetWorkedHours))}
              subtitle={
                model.displayMonthSummary.exceedsMonthlyCap
                  ? `상한 초과 ${hours(model.displayMonthSummary.totalNetWorkedHours - model.displayMonthSummary.maxAllowedHours)}`
                  : `월 상한 ${wholeHours(model.displayMonthSummary.maxAllowedHours)}`
              }
            />
            <SummaryCard
              title="1.5배 시작선"
              value={premiumStartDisplayValue(displaySelectedBreakdown, model.displayMonthSummary)}
              subtitle={premiumStartSummarySubtitle(displaySelectedBreakdown, model.displayMonthSummary)}
            />
            <SummaryCard
              title="총 실근무"
              value={workedProgressValue(model.displayMonthSummary)}
              subtitle={workedProgressSubtitle(model.displayMonthSummary)}
            />
          </div>
          <p className="hint-text summary-grid__hint">달력과 오늘 근무 콘솔은 항상 발생 기준으로 보여주고, 토글은 요약/선택일 상세에만 적용됩니다.</p>
          {model.displayMonthSummary.exceedsMonthlyCap ? (
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
          <p className="calendar-scroll-hint">좁은 화면에서는 달력을 좌우로 스크롤해 날짜를 확인할 수 있습니다.</p>

          <div className="calendar-scroll-area">
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
                const isToday = dayKey === model.todayKey

                return (
                  <button
                    key={dayKey}
                    type="button"
                    className={`calendar-cell calendar-cell--${breakdown.status} ${isSelected ? 'is-selected' : ''} ${isToday ? 'is-today' : ''}`}
                    onClick={() => model.selectDate(dayKey)}
                    data-testid={`day-cell-${dayKey}`}
                  >
                    <span className="calendar-cell__top">
                      <span className={`calendar-cell__day calendar-cell__day--${weekdayTone(weekdayIndex(dayKey))}`}>
                        {dayNumber(dayKey)}
                      </span>
                      <span className="calendar-cell__markers">
                        {isToday ? <span className="calendar-pill">오늘</span> : null}
                        {record.isRunning ? <span className="live-dot" aria-label="실시간 진행 중" /> : null}
                      </span>
                    </span>
                    <span className="calendar-cell__caption">{captionForBreakdown(breakdown)}</span>
                    <strong className="calendar-cell__pay">{currency(breakdown.totalPay)}</strong>
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        <section className="surface editor-surface">
          <SectionHeader
            title="선택한 날짜"
            subtitle={`${dayLabel(model.selectedDate)} · ${selectedStatusLabel}${model.isSelectedDateToday ? ' · 오늘 근무 패널과 동기화' : ''}`}
          />
          <div className="metrics-row">
            <MetricCard title="추가 금액" value={currency(displaySelectedBreakdown.totalPay)} />
            <MetricCard title="실근무" value={hoursFromSeconds(displaySelectedBreakdown.netWorkedSeconds)} />
            <MetricCard title="심야 가산" value={hoursFromSeconds(displaySelectedBreakdown.nightPremiumSeconds)} />
            <MetricCard
              title={displaySelectedBreakdown.lunchBreakIsAutomatic ? '점심시간(자동)' : '점심시간'}
              value={`${displaySelectedBreakdown.autoBreakMinutes}분`}
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
                      : premiumStartSummaryValue(displaySelectedBreakdown, model.displayMonthSummary, model.selectedDate)}
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

        <section className="surface settings-surface">
          <SectionHeader
            title="설정"
            subtitle={isSettingsExpanded ? '민감한 값은 펼쳤을 때만 표시합니다' : '민감한 설정값은 기본 화면에서 숨겨집니다'}
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
          ) : (
            <p className="hint-text">시급, 추가 기준 시간, 실시간 갱신 주기는 개인정보로 간주해 기본 화면에 직접 표시하지 않습니다.</p>
          )}
        </section>

        <section ref={dataSectionRef} className="surface data-surface">
          <SectionHeader title="데이터" subtitle="브라우저 로컬 저장소와 설치형 앱 안에만 저장됩니다" />
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
            JSON 불러오기는 현재 데이터를 모두 덮어쓰고, CSV는 같은 날짜일 때 가져온 값이 우선합니다. 설치형 앱에서는 `.json`/`.csv`
            파일을 직접 열어 바로 가져올 수 있습니다.
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

function PremiumModeControl({
  value,
  onChange,
}: {
  value: PremiumCalculationMode
  onChange: (mode: PremiumCalculationMode) => void
}) {
  return (
    <div className="segmented-control" role="group" aria-label="추가수당 계산 기준">
      <button
        type="button"
        className={`segmented-control__button ${value === 'occurrence' ? 'is-active' : ''}`}
        onClick={() => onChange('occurrence')}
      >
        발생 기준
      </button>
      <button
        type="button"
        className={`segmented-control__button ${value === 'settlement' ? 'is-active' : ''}`}
        onClick={() => onChange('settlement')}
      >
        정산 기준
      </button>
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

function TodayStat({ title, value }: { title: string; value: string }) {
  return (
    <article className="today-stat">
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  )
}

function TodayTimeline({ timeline }: { timeline: ShiftTimeline }) {
  return (
    <div className="shift-timeline">
      <div className="shift-timeline__summary">
        <div className="shift-timeline__summary-item shift-timeline__summary-item--start">
          <span>시작 시각</span>
          <strong>{timeline.startLabel}</strong>
        </div>
        <div className="shift-timeline__summary-item shift-timeline__summary-item--end">
          <span>{timeline.endTitle}</span>
          <strong>{timeline.endLabel}</strong>
        </div>
      </div>

      <div className="shift-timeline__track">
        <div className="shift-timeline__rail">
          {timeline.markers.map((marker) => (
            <span
              key={marker.label}
              className={`shift-timeline__marker shift-timeline__marker--${marker.tone}`}
              style={{ left: `${marker.position}%` }}
            />
          ))}
        </div>
        <div className="shift-timeline__labels">
          <span>{timeline.startLabel}</span>
          <span>{timeline.endLabel}</span>
        </div>
      </div>

      <div className="shift-timeline__legend">
        {timeline.markers.map((marker) => (
          <span key={`${marker.label}-legend`} className={`timeline-legend timeline-legend--${marker.tone}`}>
            {marker.label}
          </span>
        ))}
      </div>

      <div className="timeline-note-row">
        <div className="timeline-note">
          <span>점심 선차감</span>
          <strong>{timeline.lunchLabel}</strong>
        </div>
        <div className="timeline-note">
          <span>기타 제외</span>
          <strong>{timeline.extraExcludedLabel}</strong>
        </div>
      </div>
    </div>
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
  if (breakdown.status !== 'work') {
    return `${dayStatusDisplayName[breakdown.status]} · 근무 상태에서만 계산됩니다`
  }

  if (summary.premiumCalculationMode === 'settlement') {
    return '정산 기준 · 기준일까지 누적 실근무로 재계산'
  }

  const premiumShareHours = Math.max(0, summary.baseDailyPremiumStartHours - summary.baseDailyRequiredHours)
  const carryOverHours = Math.max(0, breakdown.carryOverShortfallHoursForDay)

  return `선택일 기준 · 필수 ${hours(summary.baseDailyRequiredHours)} + 추가 기준 분배 ${hours(premiumShareHours)} + 이월 ${hours(carryOverHours)}`
}

function premiumStartDisplayValue(
  breakdown: DayPayBreakdown,
  summary: ReturnType<typeof useAppModel>['monthSummary'],
): string {
  if (breakdown.status !== 'work') {
    return '적용 안 함'
  }

  if (summary.premiumCalculationMode === 'settlement') {
    if (!breakdown.isWithinPremiumReference) {
      return '정산 대상 아님'
    }
    if (breakdown.premiumOvertimeSeconds === 0) {
      return '미도달'
    }
  }

  return hours(breakdown.premiumStartHoursForDay)
}

function premiumStartSummaryValue(
  breakdown: DayPayBreakdown,
  summary: ReturnType<typeof useAppModel>['monthSummary'],
  dayKey: string,
): string {
  if (summary.premiumCalculationMode === 'settlement' && !breakdown.isWithinPremiumReference) {
    return '정산 대상 아님'
  }
  if (summary.premiumCalculationMode === 'settlement' && breakdown.premiumOvertimeSeconds === 0) {
    return '미도달'
  }
  if (breakdown.premiumStartTimestamp === null) {
    return '계산 불가'
  }

  return premiumStartText(breakdown.premiumStartTimestamp, dayKey)
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

function projectedExtensionValue(
  projectedBreakdown: DayPayBreakdown | null,
  currentBreakdown: DayPayBreakdown,
  record: DayRecord,
): string {
  if (projectedBreakdown === null) {
    return record.isRunning ? '계산 대기' : '진행 중일 때 표시'
  }

  return `+${currency(Math.max(0, projectedBreakdown.totalPay - currentBreakdown.totalPay))}`
}

function premiumProgressSummary(record: DayRecord, breakdown: DayPayBreakdown, nowTimestamp: number) {
  if (record.status !== 'work' || record.startMinute === null) {
    return {
      value: '근무 시작 필요',
      secondary: '출근 시작 후 계산',
      description: '오늘 근무를 시작하면 추가수당 시작 시각과 남은 시간을 바로 계산합니다.',
    }
  }

  if (breakdown.premiumStartTimestamp === null) {
    return {
      value: '계산 대기',
      secondary: '시작시간 입력 필요',
      description: '시작시간과 휴게 차감 규칙이 정해지면 추가수당 시작 시점을 계산합니다.',
    }
  }

  const remainingMinutes = Math.ceil((breakdown.premiumStartTimestamp - nowTimestamp) / (60 * 1_000))
  if (record.isRunning && remainingMinutes > 0) {
    return {
      value: durationText(remainingMinutes),
      secondary: `${premiumStartText(breakdown.premiumStartTimestamp, breakdown.dayKey)}부터 추가수당 시작`,
      description: `${durationText(remainingMinutes)} 뒤에 추가수당 구간에 진입합니다.`,
    }
  }

  if (record.isRunning) {
    return {
      value: '진입 완료',
      secondary: `${premiumStartText(breakdown.premiumStartTimestamp, breakdown.dayKey)}부터 적용 중`,
      description: '현재 추가수당 구간을 실시간으로 계산 중입니다.',
    }
  }

  return {
    value: premiumStartText(breakdown.premiumStartTimestamp, breakdown.dayKey),
    secondary: '오늘 기록 기준',
    description: '기록된 근무시간 기준으로 추가수당이 시작되는 시각입니다.',
  }
}

function workedProgressValue(summary: ReturnType<typeof useAppModel>['monthSummary']): string {
  return `${hours(summary.totalNetWorkedHours)} / ${hours(summary.recommendedHoursToDate)}`
}

function workedProgressSubtitle(summary: ReturnType<typeof useAppModel>['monthSummary']): string {
  return `실근무 / 기준일까지 권장근무 · 유효 근무일 ${summary.recommendedWorkdaysElapsed}일`
}

interface ShiftTimeline {
  startLabel: string
  endTitle: string
  endLabel: string
  lunchLabel: string
  extraExcludedLabel: string
  markers: Array<{
    label: string
    position: number
    tone: 'start' | 'premium' | 'night' | 'end'
  }>
}

function timelineForRecord(record: DayRecord, breakdown: DayPayBreakdown, nowTimestamp: number): ShiftTimeline | null {
  if (record.status !== 'work' || record.startMinute === null) {
    return null
  }

  const shiftStartTimestamp = combineDayAndMinutes(record.dayKey, record.startMinute)
  const shiftEndTimestamp = resolveShiftEndTimestamp(record, nowTimestamp)
  if (shiftEndTimestamp === null || shiftEndTimestamp <= shiftStartTimestamp) {
    return null
  }

  const totalSpan = Math.max(1, shiftEndTimestamp - shiftStartTimestamp)
  const markers: ShiftTimeline['markers'] = [
    {
      label: `시작 ${clockText(record.startMinute)}`,
      position: 0,
      tone: 'start',
    },
  ]

  if (breakdown.premiumStartTimestamp !== null) {
    markers.push({
      label: `추가수당 ${premiumStartText(breakdown.premiumStartTimestamp, record.dayKey)}`,
      position: clampPercent(((breakdown.premiumStartTimestamp - shiftStartTimestamp) / totalSpan) * 100),
      tone: 'premium',
    })
  }

  if (record.nightPremiumEnabled) {
    const nightTimestamp = combineDayAndMinutes(record.dayKey, 22 * 60)
    if (nightTimestamp >= shiftStartTimestamp && nightTimestamp <= shiftEndTimestamp) {
      markers.push({
        label: '22:00 이후 가산',
        position: clampPercent(((nightTimestamp - shiftStartTimestamp) / totalSpan) * 100),
        tone: 'night',
      })
    }
  }

  markers.push({
    label: `${record.isRunning ? '현재' : '종료'} ${clockText(minutesForTimestampLabel(shiftEndTimestamp))}`,
    position: 100,
    tone: 'end',
  })

  return {
    startLabel: clockText(record.startMinute),
    endTitle: record.isRunning ? '현재 시각' : '종료 시각',
    endLabel: record.isRunning ? `현재 ${clockText(minutesForTimestampLabel(shiftEndTimestamp))}` : premiumStartText(shiftEndTimestamp, record.dayKey),
    lunchLabel: durationText(breakdown.autoBreakMinutes),
    extraExcludedLabel: durationText(record.extraExcludedMinutes),
    markers,
  }
}

function resolveShiftEndTimestamp(record: DayRecord, nowTimestamp: number): number | null {
  if (record.startMinute === null) {
    return null
  }

  const shiftStartTimestamp = combineDayAndMinutes(record.dayKey, record.startMinute)
  if (record.isRunning) {
    return Math.max(nowTimestamp, shiftStartTimestamp)
  }

  if (record.endMinute === null) {
    return null
  }

  return combineDayAndMinutes(record.dayKey, record.endMinute, record.endsNextDay)
}

function minutesForTimestampLabel(timestamp: number): number {
  const date = new Date(timestamp)
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mediaQuery = window.matchMedia(query)
    const updateMatch = () => setMatches(mediaQuery.matches)

    updateMatch()
    mediaQuery.addEventListener('change', updateMatch)
    return () => {
      mediaQuery.removeEventListener('change', updateMatch)
    }
  }, [query])

  return matches
}

function emptyBreakdown(dayKey: string, status: DayPayBreakdown['status']): DayPayBreakdown {
  return {
    dayKey,
    status,
    holidayName: null,
    requiredHoursForDay: 0,
    premiumStartHoursForDay: 0,
    carryOverShortfallHoursForDay: 0,
    isWithinPremiumReference: true,
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
