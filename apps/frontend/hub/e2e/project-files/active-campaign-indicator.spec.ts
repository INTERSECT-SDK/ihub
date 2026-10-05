import { expect, test } from './fixtures.ts'

test('shows only the active campaign indicator and removes it when terminal', async ({
  page,
  projectFiles,
}) => {
  const activeRow = projectFiles.row(
    page,
    projectFiles.contentPath('active.icmp'),
  )
  const inactiveRow = projectFiles.row(
    page,
    projectFiles.contentPath('inactive.icmp'),
  )
  const indicatorName = 'Campaign is active'

  await expect(
    activeRow.getByRole('status', { name: indicatorName }),
  ).toBeVisible()
  await expect(
    inactiveRow.getByRole('status', { name: indicatorName }),
  ).toHaveCount(0)

  await activeRow.getByRole('button', { name: 'Rename file' }).click()
  await expect(
    activeRow.getByRole('status', { name: indicatorName }),
  ).toBeVisible()
  await activeRow.getByRole('button', { name: 'Cancel rename' }).click()

  await activeRow.dblclick()
  const activeTab = page.locator('header').getByText('active', { exact: true })
  await expect(activeTab).toBeVisible()
  await expect(page).toHaveURL(
    new RegExp(`/hub/project/${projectFiles.projectId}/active\\.icmp$`),
  )
  await expect(
    page.getByRole('button', { name: 'Open Launcher tab' }),
  ).toBeEnabled()

  await inactiveRow.dblclick()
  const inactiveTab = page
    .locator('header')
    .getByText('inactive', { exact: true })
  await expect(inactiveTab).toBeVisible()
  await expect(
    activeTab.locator('..').getByRole('status', { name: indicatorName }),
  ).toBeVisible()
  await expect(
    inactiveTab.locator('..').getByRole('status', { name: indicatorName }),
  ).toHaveCount(0)

  await page.getByRole('button', { name: 'Project Files' }).click()
  await expect(page.getByRole('table', { name: 'Project files' })).toBeHidden()

  projectFiles.setCampaignRunStatus('COMPLETED')
  await expect(
    activeTab.locator('..').getByRole('status', { name: indicatorName }),
  ).toHaveCount(0, { timeout: 10_000 })
})
