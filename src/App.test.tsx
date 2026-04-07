import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

describe('App', () => {
  it('starts with a default hourly rate of 10,000 won', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('heading', { name: /windows에서도 같은 계산 규칙/i })).toBeInTheDocument()

    const hourlyRateInput = screen.getByLabelText('시급') as HTMLInputElement
    expect(hourlyRateInput.value).toBe('10000')

    await user.clear(hourlyRateInput)
    await user.type(hourlyRateInput, '12345')

    expect(hourlyRateInput.value).toBe('12345')
  })
})
