import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { createMemoryStorage } from './domain/persistence'

describe('App', () => {
  it('starts with a default hourly rate of 10,000 won', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('heading', { name: 'PayClock' })).toBeInTheDocument()
    expect(screen.queryByLabelText('시급')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '설정 보기' }))

    const hourlyRateInput = screen.getByLabelText('시급') as HTMLInputElement
    expect(hourlyRateInput.value).toBe('10000')

    await user.clear(hourlyRateInput)
    await user.type(hourlyRateInput, '12345')

    expect(hourlyRateInput.value).toBe('12345')
  })

  it('hides settings inputs until the settings panel is expanded', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.queryByLabelText('시급')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('1.5배 기준 추가 시간')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('실시간 갱신 주기')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '설정 보기' }))

    expect(screen.getByLabelText('시급')).toBeInTheDocument()
    expect(screen.getByLabelText('1.5배 기준 추가 시간')).toBeInTheDocument()
    expect(screen.getByLabelText('실시간 갱신 주기')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '설정 숨기기' }))

    expect(screen.queryByLabelText('시급')).not.toBeInTheDocument()
  })

  it('shows an install button only when a deferred install prompt is available', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.queryByRole('button', { name: '앱 설치' })).not.toBeInTheDocument()

    let resolveChoice!: (value: { outcome: 'accepted' | 'dismissed'; platform: string }) => void
    const userChoice = new Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>((resolve) => {
      resolveChoice = resolve
    })
    const prompt = vi.fn().mockResolvedValue(undefined)

    const installEvent = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
    }
    installEvent.prompt = prompt
    installEvent.userChoice = userChoice

    window.dispatchEvent(installEvent)

    const installButton = await screen.findByRole('button', { name: '앱 설치' })
    await user.click(installButton)

    expect(prompt).toHaveBeenCalledTimes(1)

    resolveChoice({ outcome: 'accepted', platform: 'web' })

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '앱 설치' })).not.toBeInTheDocument()
    })
  })

  it('keeps the today console anchored to today while selected-day summary changes', async () => {
    const originalLocalStorage = window.localStorage
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'))

    try {
      Object.defineProperty(window, 'localStorage', {
        value: createMemoryStorage(),
        configurable: true,
      })
      window.localStorage.setItem(
        'payclock:data:v1',
        JSON.stringify({
          settings: {
            hourlyRate: 100,
            premiumThresholdHours: 14,
            refreshIntervalSeconds: 1,
          },
          records: [
            {
              id: 'aug-4-work',
              dayKey: '2026-08-04',
              status: 'work',
              startMinute: 9 * 60,
              endMinute: 13 * 60,
              endsNextDay: false,
              lunchBreakOverrideMinutes: null,
              extraExcludedMinutes: 0,
              nightPremiumEnabled: false,
              note: '',
              isRunning: false,
            },
          ],
        }),
      )

      render(<App />)

      const initialSummaryValue = summaryCardValue('1.5배 시작선')
      expect(initialSummaryValue).toBe('9.2시간')
      expect(todayStatValue('추가수당 시작')).toBe('18:09')
      expect(screen.getByText('8월 4일 화요일 · 근무')).toBeInTheDocument()
      expect(summaryCardValue('총 실근무')).toBe('4.0시간 / 16.0시간')

      fireEvent.click(screen.getByTestId('day-cell-2026-08-05'))

      const updatedSummaryValue = summaryCardValue('1.5배 시작선')
      expect(updatedSummaryValue).toBe('9.4시간')
      expect(updatedSummaryValue).not.toBe(initialSummaryValue)
      expect(todayStatValue('추가수당 시작')).toBe('18:09')
      expect(screen.getByText('8월 4일 화요일 · 근무')).toBeInTheDocument()
      expect(summaryCardSubtitle('1.5배 시작선')).toBe('선택일 기준 · 필수 8.0시간 + 추가 기준 분배 0.7시간 + 이월 0.7시간')
      expect(summaryCardSubtitle('총 실근무')).toBe('실근무 / 기준일까지 권장근무 · 유효 근무일 2일')
    } finally {
      Object.defineProperty(window, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      })
      vi.useRealTimers()
    }
  })

  it('shows work-required guidance in the today console on non-work days', () => {
    const originalLocalStorage = window.localStorage
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'))

    try {
      Object.defineProperty(window, 'localStorage', {
        value: createMemoryStorage(),
        configurable: true,
      })
      window.localStorage.setItem(
        'payclock:data:v1',
        JSON.stringify({
          settings: {
            hourlyRate: 100,
            premiumThresholdHours: 14,
            refreshIntervalSeconds: 1,
          },
          records: [
            {
              id: 'aug-4-leave',
              dayKey: '2026-08-04',
              status: 'annualLeave',
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
        }),
      )

      render(<App />)

      expect(summaryCardValue('1.5배 시작선')).toBe('적용 안 함')
      expect(summaryCardSubtitle('1.5배 시작선')).toBe('연차 · 근무 상태에서만 계산됩니다')
      expect(todayStatValue('추가수당 시작')).toBe('근무 시작 필요')
      expect(screen.getByText('8월 4일 화요일 · 연차')).toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      })
      vi.useRealTimers()
    }
  })

  it('switches summary and selected-day detail between occurrence and settlement while the today console stays on occurrence', () => {
    const originalLocalStorage = window.localStorage
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'))

    try {
      Object.defineProperty(window, 'localStorage', {
        value: createMemoryStorage(),
        configurable: true,
      })
      window.localStorage.setItem(
        'payclock:data:v1',
        JSON.stringify({
          settings: {
            hourlyRate: 100,
            premiumThresholdHours: 14,
            refreshIntervalSeconds: 1,
          },
          records: [
            {
              id: 'aug-3-night',
              dayKey: '2026-08-03',
              status: 'work',
              startMinute: 13 * 60,
              endMinute: 23 * 60 + 30,
              endsNextDay: false,
              lunchBreakOverrideMinutes: null,
              extraExcludedMinutes: 0,
              nightPremiumEnabled: true,
              note: '',
              isRunning: false,
            },
            {
              id: 'aug-4-long',
              dayKey: '2026-08-04',
              status: 'work',
              startMinute: 9 * 60,
              endMinute: 20 * 60,
              endsNextDay: false,
              lunchBreakOverrideMinutes: null,
              extraExcludedMinutes: 0,
              nightPremiumEnabled: false,
              note: '',
              isRunning: false,
            },
          ],
        }),
      )

      render(<App />)

      expect(summaryCardValue('1.5배 시작선')).toBe('8.7시간')
      expect(summaryCardSubtitle('총 추가 금액')).toBe('1.5배 대상 2.1시간 · 심야 가산 0.8시간')
      expect(metricCardValue('추가 금액')).toBe('₩195')
      expect(screen.getByTestId('live-pay')).toHaveTextContent('₩195')

      fireEvent.click(screen.getByRole('button', { name: '정산 기준' }))

      expect(summaryCardValue('1.5배 시작선')).toBe('9.4시간')
      expect(summaryCardSubtitle('1.5배 시작선')).toBe('정산 기준 · 기준일까지 누적 실근무로 재계산')
      expect(summaryCardSubtitle('총 추가 금액')).toBe('1.5배 대상 2.1시간 · 심야 가산 1.5시간')
      expect(metricCardValue('추가 금액')).toBe('₩90')
      expect(screen.getByTestId('live-pay')).toHaveTextContent('₩195')
      expect(todayStatValue('이번 달 누적')).toBe('₩355')
    } finally {
      Object.defineProperty(window, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      })
      vi.useRealTimers()
    }
  })

  it('marks future selected days as outside settlement reference and does not persist the mode toggle', () => {
    const originalLocalStorage = window.localStorage
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'))

    try {
      Object.defineProperty(window, 'localStorage', {
        value: createMemoryStorage(),
        configurable: true,
      })

      render(<App />)

      fireEvent.click(screen.getByTestId('day-cell-2026-08-05'))
      fireEvent.click(screen.getByRole('button', { name: '정산 기준' }))

      expect(summaryCardValue('1.5배 시작선')).toBe('정산 대상 아님')
      expect(summaryCardSubtitle('1.5배 시작선')).toBe('정산 기준 · 기준일까지 누적 실근무로 재계산')

      const persisted = window.localStorage.getItem('payclock:data:v1')
      expect(persisted).toBeNull()
    } finally {
      Object.defineProperty(window, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      })
      vi.useRealTimers()
    }
  })

  it('starts and stops today work from the quick action buttons', () => {
    const originalLocalStorage = window.localStorage
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T00:15:00.000Z'))

    try {
      Object.defineProperty(window, 'localStorage', {
        value: createMemoryStorage(),
        configurable: true,
      })

      render(<App />)

      fireEvent.click(screen.getByRole('button', { name: '출근 시작' }))

      expect(screen.getByText('8월 4일 화요일 · 실시간 진행 중')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '근무 종료' })).toBeEnabled()

      fireEvent.click(screen.getByRole('button', { name: '근무 종료' }))

      expect(screen.queryByText('8월 4일 화요일 · 실시간 진행 중')).not.toBeInTheDocument()
      expect(window.localStorage.getItem('payclock:data:v1')).toContain('"endMinute": 555')
    } finally {
      Object.defineProperty(window, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      })
      vi.useRealTimers()
    }
  })
})

function summaryCardValue(title: string): string {
  const card = screen.getByText(title).closest('article')
  expect(card).not.toBeNull()

  const value = card?.querySelector('.summary-card__value')?.textContent
  expect(value).toBeTruthy()
  return value as string
}

function summaryCardSubtitle(title: string): string {
  const card = screen.getByText(title).closest('article')
  expect(card).not.toBeNull()

  const subtitle = card?.querySelector('.summary-card__subtitle')?.textContent
  expect(subtitle).toBeTruthy()
  return subtitle as string
}

function todayStatValue(label: string): string {
  const stat = screen
    .getAllByText(label)
    .map((candidate) => candidate.closest('article'))
    .find((candidate) => candidate?.classList.contains('today-stat'))
  expect(stat).not.toBeNull()

  const value = stat?.querySelector('strong')?.textContent
  expect(value).toBeTruthy()
  return value as string
}

function metricCardValue(title: string): string {
  const card = screen.getByText(title).closest('article')
  expect(card).not.toBeNull()

  const value = card?.querySelector('.metric-card__value')?.textContent
  expect(value).toBeTruthy()
  return value as string
}
