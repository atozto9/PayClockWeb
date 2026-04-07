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

  it('keeps the live card premium line aligned with the selected day', async () => {
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
      expect(initialSummaryValue).toBe('9.1시간')
      expect(liveCardStatValue('Premium line')).toBe(initialSummaryValue)

      fireEvent.click(screen.getByTestId('day-cell-2026-08-05'))

      const updatedSummaryValue = summaryCardValue('1.5배 시작선')
      expect(updatedSummaryValue).toBe('9.4시간')
      expect(updatedSummaryValue).not.toBe(initialSummaryValue)
      expect(liveCardStatValue('Premium line')).toBe(updatedSummaryValue)
      expect(summaryCardSubtitle('1.5배 시작선')).toBe('선택일 기준 · 기본 8.0시간 + 부족분 0.7시간 + 분배 0.7시간')
    } finally {
      Object.defineProperty(window, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      })
      vi.useRealTimers()
    }
  })

  it('shows the premium line as unavailable on non-work selected days', () => {
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
      expect(liveCardStatValue('Premium line')).toBe('적용 안 함')
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

function liveCardStatValue(label: string): string {
  const stat = screen.getByText(label).closest('article')
  expect(stat).not.toBeNull()

  const value = stat?.querySelector('strong')?.textContent
  expect(value).toBeTruthy()
  return value as string
}
