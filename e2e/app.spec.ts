import { expect, test } from '@playwright/test'

test('loads and persists hourly rate locally', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'PayClock' })).toBeVisible()

  await page.getByRole('button', { name: '설정 보기' }).click()
  const hourlyRateInput = page.getByLabel('시급')
  await expect(hourlyRateInput).toHaveValue('10000')
  await hourlyRateInput.fill('12345')

  await page.reload()
  await page.getByRole('button', { name: '설정 보기' }).click()
  await expect(page.getByLabel('시급')).toHaveValue('12345')
})
