// spec: e2e/project-files/specs/project-files.plan.md
// seed: e2e/project-files/seed.spec.ts
import type { Page } from '@playwright/test'

import { expect, test, type ProjectFilesFixture } from './fixtures.ts'

const campaignFile = 'navigation.icmp'
const inputLabel = 'Custom value for Message'
type CanvasViewport = { x: number; y: number; zoom: number }

async function readCanvasViewport(page: Page): Promise<CanvasViewport> {
  return page.locator('.react-flow__viewport').evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform)
    const round = (value: number) => Math.round(value * 1000) / 1000

    return {
      x: round(matrix.e),
      y: round(matrix.f),
      zoom: round(matrix.a),
    }
  })
}

async function panCanvas(
  page: Page,
  delta: { x: number; y: number },
): Promise<void> {
  const pane = page.locator('.react-flow__pane')
  const box = await pane.boundingBox()
  if (!box) {
    throw new Error('Campaign canvas pane is not visible')
  }

  const start = {
    x: box.x + box.width - 80,
    y: box.y + 80,
  }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 10 })
  await page.mouse.up()
}

async function openCapabilityPanel(page: Page): Promise<void> {
  const openCanvasButton = page.getByRole('button', { name: 'Open canvas' })
  const toggleDetailsButton = page.getByRole('button', {
    name: 'Toggle node details',
  })
  await expect(openCanvasButton.or(toggleDetailsButton).first()).toBeVisible()
  if (await openCanvasButton.isVisible()) {
    await openCanvasButton.click()
  }
  await toggleDetailsButton.click()
}

async function openCampaign(
  page: Page,
  projectFiles: ProjectFilesFixture,
): Promise<void> {
  await projectFiles
    .row(page, projectFiles.contentPath(campaignFile))
    .dblclick()
  await expect(page).toHaveURL(
    new RegExp(`/hub/project/${projectFiles.projectId}/navigation\\.icmp$`),
  )
  await openCapabilityPanel(page)
  await expect(page.getByRole('textbox', { name: inputLabel })).toBeVisible()
}

test.describe('Project-file navigation save barrier', () => {
  test('campaign creation defers the file save without treating directories as saves', async ({
    page,
    projectFiles,
  }) => {
    const newFileName = 'New Campaign 1.icmp'
    const newFilePath = projectFiles.contentPath(newFileName)
    const deferredSave = projectFiles.deferNext('save')

    await page.getByRole('button', { name: 'Campaign', exact: true }).click()
    const createSave = await projectFiles.waitForRequest('save', {
      logicalPath: newFilePath,
    })

    expect(createSave.logicalPath).toBe(newFilePath)
    expect(
      projectFiles
        .readRequestLog()
        .filter((entry) => entry.operation === 'save')
        .map((entry) => entry.logicalPath),
    ).toEqual([newFilePath])
    await expect(page).toHaveURL(/New%20Campaign%201\.icmp\?create=1$/)

    projectFiles.resolveDeferred(deferredSave)
    await expect(
      page.getByRole('button', { name: 'Open Launcher tab' }),
    ).toBeEnabled()
    await page.getByRole('button', { name: 'Open Launcher tab' }).click()
    await expect(page).toHaveURL(
      new RegExp(`/hub/project/${projectFiles.projectId}$`),
    )
    await projectFiles.openProjectFiles(page)
    await expect(projectFiles.row(page, newFilePath)).toBeVisible()
  })

  test('allows navigation away after the editor fails to load', async ({
    page,
    projectFiles,
  }) => {
    projectFiles.failLoadsFor(projectFiles.contentPath(campaignFile))
    await projectFiles
      .row(page, projectFiles.contentPath(campaignFile))
      .dblclick()

    await expect(page.getByText(/Failed to load file: 500/)).toBeVisible()
    await page.getByRole('button', { name: 'Open Launcher tab' }).click()
    await expect(page).toHaveURL(
      new RegExp(`/hub/project/${projectFiles.projectId}$`),
    )
  })

  test('restores each campaign sheet viewport after switching app tabs', async ({
    page,
    projectFiles,
  }) => {
    await projectFiles
      .row(page, projectFiles.contentPath(campaignFile))
      .dblclick()
    const campaignTab = page.getByRole('button', {
      name: 'Campaign',
      exact: true,
    })
    const taskGroupTab = page.getByRole('button', {
      name: 'Task Group 1',
      exact: true,
    })

    await page.getByRole('button', { name: 'Zoom in' }).click()
    await expect
      .poll(() => readCanvasViewport(page))
      .toMatchObject({ zoom: 1.08 })
    await panCanvas(page, { x: -120, y: 70 })
    const campaignViewport = await readCanvasViewport(page)

    await taskGroupTab.click()
    await expect(taskGroupTab).toHaveAttribute('data-selected', 'true')
    await expect(page.getByText('Navigation Capability')).toBeVisible()
    await expect
      .poll(() => readCanvasViewport(page))
      .toEqual({
        x: 0,
        y: 0,
        zoom: 0.9,
      })

    await page.getByRole('button', { name: 'Zoom out' }).click()
    await expect
      .poll(() => readCanvasViewport(page))
      .toMatchObject({ zoom: 0.75 })
    await panCanvas(page, { x: 90, y: -55 })
    const taskGroupViewport = await readCanvasViewport(page)

    await campaignTab.click()
    await expect(campaignTab).toHaveAttribute('data-selected', 'true')
    await expect.poll(() => readCanvasViewport(page)).toEqual(campaignViewport)

    await page.getByRole('button', { name: 'Open Launcher tab' }).click()
    await expect(page).toHaveURL(
      new RegExp(`/hub/project/${projectFiles.projectId}$`),
    )
    await page.getByRole('button', { name: /navigation/i }).click()

    await expect(campaignTab).toHaveAttribute('data-selected', 'true')
    await expect.poll(() => readCanvasViewport(page)).toEqual(campaignViewport)

    await taskGroupTab.click()
    await expect(taskGroupTab).toHaveAttribute('data-selected', 'true')
    await expect(page.getByText('Navigation Capability')).toBeVisible()
    await expect.poll(() => readCanvasViewport(page)).toEqual(taskGroupViewport)
  })

  test('waits for save completion before switching tabs and persists the input', async ({
    page,
    projectFiles,
  }) => {
    await openCampaign(page, projectFiles)
    const updatedValue = 'saved before navigation'
    const deferredSave = projectFiles.deferNext('save')
    await page.getByRole('textbox', { name: inputLabel }).fill(updatedValue)

    await page.getByRole('button', { name: 'Open Launcher tab' }).click()
    await projectFiles.waitForRequest('save', {
      logicalPath: projectFiles.contentPath(campaignFile),
    })

    await expect(page).toHaveURL(/navigation\.icmp$/)
    await expect(
      page.getByRole('button', { name: 'Open Launcher tab' }),
    ).toBeDisabled()
    await expect(page.getByRole('textbox', { name: inputLabel })).toHaveValue(
      updatedValue,
    )

    projectFiles.resolveDeferred(deferredSave)
    await expect(page).toHaveURL(
      new RegExp(`/hub/project/${projectFiles.projectId}$`),
    )

    await page.getByRole('button', { name: /navigation/i }).click()
    await openCapabilityPanel(page)
    await expect(page.getByRole('textbox', { name: inputLabel })).toHaveValue(
      updatedValue,
    )
  })

  test('saves before navigation when BroadcastChannel is unavailable', async ({
    page,
    projectFiles,
  }) => {
    await page.evaluate(() => {
      Object.defineProperty(window, 'BroadcastChannel', {
        configurable: true,
        value: undefined,
      })
    })
    await openCampaign(page, projectFiles)
    const updatedValue = 'saved without rename coordination'
    const deferredSave = projectFiles.deferNext('save')
    await page.getByRole('textbox', { name: inputLabel }).fill(updatedValue)

    await page.getByRole('button', { name: 'Open Launcher tab' }).click()
    await projectFiles.waitForRequest('save', {
      logicalPath: projectFiles.contentPath(campaignFile),
    })
    await expect(page).toHaveURL(/navigation\.icmp$/)

    projectFiles.resolveDeferred(deferredSave)
    await expect(page).toHaveURL(
      new RegExp(`/hub/project/${projectFiles.projectId}$`),
    )
    expect(projectFiles.readPersistedContent(campaignFile)).toMatchObject({
      task_groups: [
        {
          tasks: [
            {
              manual_input_values: { message: updatedValue },
            },
          ],
        },
      ],
    })
  })

  test('reselecting the highlighted tab repairs browser history after saving', async ({
    page,
    projectFiles,
  }) => {
    await openCampaign(page, projectFiles)
    await page.getByRole('button', { name: 'Open Launcher tab' }).click()
    await expect(page).toHaveURL(
      new RegExp(`/hub/project/${projectFiles.projectId}$`),
    )

    await page.goBack()
    await expect(page).toHaveURL(/navigation\.icmp$/)
    await openCapabilityPanel(page)
    const updatedValue = 'saved while repairing browser history'
    const deferredSave = projectFiles.deferNext('save')
    await page.getByRole('textbox', { name: inputLabel }).fill(updatedValue)

    const launcherTab = page.locator('button[data-active="true"]', {
      hasText: /^Launcher$/,
    })
    await expect(launcherTab).toHaveAttribute('data-active', 'true')
    await launcherTab.click()
    await projectFiles.waitForRequest('save', {
      logicalPath: projectFiles.contentPath(campaignFile),
    })
    await expect(page).toHaveURL(/navigation\.icmp$/)

    projectFiles.resolveDeferred(deferredSave)
    await expect(page).toHaveURL(
      new RegExp(`/hub/project/${projectFiles.projectId}$`),
    )
    expect(projectFiles.readPersistedContent(campaignFile)).toMatchObject({
      task_groups: [
        {
          tasks: [
            {
              manual_input_values: { message: updatedValue },
            },
          ],
        },
      ],
    })
  })

  test('failed save keeps the edit and route until Retry succeeds', async ({
    page,
    projectFiles,
  }) => {
    await openCampaign(page, projectFiles)
    const updatedValue = 'retry preserves this value'
    projectFiles.failNext('save')
    await page.getByRole('textbox', { name: inputLabel }).fill(updatedValue)

    await page.getByRole('button', { name: 'Open Launcher tab' }).click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Changes not saved' }),
    ).toBeVisible()
    await expect(page).toHaveURL(/navigation\.icmp$/)
    await expect(page.getByRole('textbox', { name: inputLabel })).toHaveValue(
      updatedValue,
    )

    const failedSave = projectFiles
      .readRequestLog()
      .filter((entry) => entry.operation === 'save')
      .at(-1)
    const retryRequest = projectFiles.waitForRequest('save', {
      afterOrder: failedSave?.order,
      logicalPath: projectFiles.contentPath(campaignFile),
    })
    await page.getByRole('button', { name: 'Retry' }).click()
    await retryRequest
    await expect(
      page.getByRole('alert').filter({ hasText: 'Changes not saved' }),
    ).toBeHidden()

    await page.getByRole('button', { name: 'Open Launcher tab' }).click()
    await expect(page).toHaveURL(
      new RegExp(`/hub/project/${projectFiles.projectId}$`),
    )
    await page.getByRole('button', { name: /navigation/i }).click()
    await openCapabilityPanel(page)
    await expect(page.getByRole('textbox', { name: inputLabel })).toHaveValue(
      updatedValue,
    )
  })
})
