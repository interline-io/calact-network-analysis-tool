import { test, expect } from '@playwright/test'

test.describe('Smoke tests', () => {
  test('home page loads', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/CALACT NAT/)
  })

  test('TNE page loads with query panel', async ({ page }) => {
    await page.goto('/tne')
    await page.waitForLoadState('networkidle')

    // Query panel should be visible with key sections
    await expect(page.getByText('Transit Network Explorer')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Geographic Bounds', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run Browse Query' })).toBeVisible()
  })

  test('geography selector shows boundary layer dropdown', async ({ page }) => {
    await page.goto('/tne')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Transit Network Explorer')).toBeVisible({ timeout: 15000 })

    // Select "Administrative boundary" from geography selector
    const geomSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Administrative boundary' }) })
    await geomSelect.selectOption('adminBoundary')

    // Boundary layer dropdown should appear
    await expect(page.getByText('Boundary type')).toBeVisible({ timeout: 5000 })
  })
})
