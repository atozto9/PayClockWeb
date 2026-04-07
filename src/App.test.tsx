import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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

  it('shows the selected day premium line instead of the monthly average', () => {
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
              endMinute: 18 * 60,
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

      const card = screen.getByText('1.5배 시작선').closest('article')
      expect(card).not.toBeNull()
      expect(within(card as HTMLElement).getByText('9.1시간')).toBeInTheDocument()
      expect(
        within(card as HTMLElement).getByText('선택일 기준 · 기본 8.0시간 + 부족분 0.4시간 + 분배 0.7시간'),
      ).toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      })
      vi.useRealTimers()
    }
  })
})
