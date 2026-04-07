import { expect, test } from '@playwright/test'

test('loads and persists hourly rate locally', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: /windows에서도 같은 계산 규칙/i })).toBeVisible()

  const hourlyRateInput = page.getByLabel('시급')
  await expect(hourlyRateInput).toHaveValue('10000')
  await hourlyRateInput.fill('12345')

  await page.reload()
  await expect(hourlyRateInput).toHaveValue('12345')
})
